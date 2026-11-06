import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { Staff } from '../src/models/Staff.js';
import { Analysis } from '../src/models/Analysis.js';
import { AuditEvent } from '../src/models/AuditEvent.js';
import { Review } from '../src/models/Review.js';
import { ScoutingCase } from '../src/models/ScoutingCase.js';
import { RateBucket } from '../src/models/RateBucket.js';
import { processNextAnalysis } from '../src/services/analysis.worker.js';
import type { Config } from '../src/config/env.js';
import type { AnalysisData } from '../src/models/Analysis.js';
import { validateAiResult } from '../src/services/ai-analysis.js';
const config: Config = {
  port: 4000,
  mongoUri: '',
  jwtSecret: 'test-only-secret-longer-than-32-characters',
  origin: 'http://localhost:5173',
  production: false,
  trustProxyHops: 0,
  aiProvider: 'openai',
  aiKey: 'test-only-not-a-real-key',
  aiModel: 'test-fixture-not-an-openai-call',
  frontendDist: 'missing-test-folder',
  workerEnabled: false,
};
const app = createApp(config),
  agent = request.agent(app),
  outsider = request.agent(app);
let replica: MongoMemoryReplSet, caseId: string;
const input = {
  title: 'กิจการตัวอย่างทดสอบ',
  contactName: 'ชื่อเก็บภายใน',
  contactPhone: '0800000000',
  contactEmail: 'internal@example.test',
  sourceChannel: 'แบบฟอร์ม',
  sourceReference: 'test-001',
  referenceDate: '2026-11-03',
  permissionStatus: 'granted',
  permissionReference: 'test-permission',
  allowAiProcessing: true,
  answers: {
    B1: 'ยังไม่มีข้อมูลต้นทุน',
    D3: 'ยังไม่ทราบ',
    A3: 'นิสิต',
    A5: 3,
    nationalityThai: 'ใช่',
    trlNumeric: 2,
    trlVerified: 'ใช่',
    tedFellow: 'ใช่',
  },
};
const fixtureProvider = {
  name: 'OpenAI' as const,
  analyze: async () => ({
    result: {
      summary: 'ผลจำลองสำหรับ integration test เท่านั้น',
      tedAssessment: {
        developmentStage: {
          stage: 'UNCLEAR' as const,
          reason: 'ยังไม่มีรายละเอียดระยะพัฒนาเพียงพอ',
          evidenceRefs: ['B1'],
        },
        classification: 'INSUFFICIENT_DATA' as const,
        reason: 'มีเพียงข้อมูลความต้องการ ยังแยกประเภทไม่ได้',
        alternativeReason:
          'ยังไม่มีข้อมูลพอเทียบแนวคิดกับการพิสูจน์เชิงพาณิชย์',
        evidenceRefs: ['B1'],
        uncertainties: ['ยังไม่ทราบผลพัฒนาผลิตภัณฑ์และหลักฐานตลาด'],
      },
      programRecommendations: [],
      expertRecommendations: [
        {
          area: 'FINANCE',
          need: 'รู้ต้นทุน',
          reason: 'ยังไม่ทราบต้นทุน',
          evidenceRefs: ['D3'],
        },
      ],
      missingInformation: ['ขอข้อมูลเทคโนโลยีและตลาดเพิ่มเติม'],
    },
    requestId: null,
  }),
};
const headers = { 'X-Requested-With': 'ScoutingWeb', Origin: config.origin };
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replica.getUri());
  await Promise.all([
    Staff.init(),
    Analysis.init(),
    AuditEvent.init(),
    Review.init(),
    ScoutingCase.init(),
    RateBucket.init(),
  ]);
  const passwordHash = await bcrypt.hash('Test-password-2026', 4);
  await Staff.create([
    {
      email: 'officer@example.test',
      name: 'เจ้าหน้าที่ทดสอบ',
      organizationId: 'nu-seed',
      passwordHash,
    },
    {
      email: 'other@example.test',
      name: 'องค์กรอื่น',
      organizationId: 'other',
      passwordHash,
    },
  ]);
  await agent
    .post('/api/auth/login')
    .set(headers)
    .send({ email: 'officer@example.test', password: 'Test-password-2026' })
    .expect(200);
  await outsider
    .post('/api/auth/login')
    .set(headers)
    .send({ email: 'other@example.test', password: 'Test-password-2026' })
    .expect(200);
}, 120000);
afterAll(async () => {
  await mongoose.disconnect();
  if (replica) await replica.stop();
});
describe('authenticated case workflow with transactional MongoDB', () => {
  it('denies unauthenticated case access', async () => {
    await request(app).get('/api/cases').expect(401);
  });
  it('denies cross-site writes and missing CSRF header', async () => {
    await agent.post('/api/cases').send(input).expect(403);
    await agent
      .post('/api/cases')
      .set({ ...headers, Origin: 'https://evil.example' })
      .send(input)
      .expect(403);
  });
  it('creates one case for retries and ignores no privileges from body', async () => {
    const key = randomUUID();
    const response = await agent
      .post('/api/cases')
      .set(headers)
      .set('Idempotency-Key', key)
      .send({ ...input, organizationId: 'other', revision: 90 })
      .expect(201);
    caseId = response.body.caseRecord._id;
    expect(response.body.caseRecord.revision).toBe(1);
    const again = await agent
      .post('/api/cases')
      .set(headers)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
    expect(again.body.caseRecord._id).toBe(caseId);
    expect(await ScoutingCase.countDocuments()).toBe(1);
  });
  it('isolates organizations, including analyses and history', async () => {
    await outsider.get(`/api/cases/${caseId}`).expect(404);
    await outsider.get(`/api/cases/${caseId}/history`).expect(404);
    await outsider
      .post(`/api/cases/${caseId}/analyses`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 1 })
      .expect(404);
  });
  it('lists, searches and returns no password hashes', async () => {
    const r = await agent
      .get('/api/cases?q=' + encodeURIComponent('กิจการ'))
      .expect(200);
    expect(r.body.items).toHaveLength(1);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
  });
  it('persists queued AI snapshot without separate identity/contact fields', async () => {
    await agent
      .post(`/api/cases/${caseId}/analyses`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 1 })
      .expect(202);
    const run = await Analysis.findOne({ caseId });
    expect(run?.provider).toBe('OpenAI');
    expect(run?.model).toBe(config.aiModel);
    expect(JSON.stringify(run?.inputSnapshot)).not.toContain('0800000000');
    await agent
      .post(`/api/cases/${caseId}/analyses`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 1 })
      .expect(409);
  });
  it('rejects review while analysis pending, processes worker result', async () => {
    const run = await Analysis.findOne({ caseId });
    await agent
      .post(`/api/cases/${caseId}/reviews`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({
        revision: 1,
        decisionVersion: 0,
        analysisId: String(run!._id),
        destination: null,
        expertAreas: ['FINANCE'],
        notes: 'ตรวจแล้ว',
      })
      .expect(409);
    expect(await processNextAnalysis(fixtureProvider)).toBe(true);
    const finished = await Analysis.findOne({ caseId });
    expect(finished?.status).toBe('succeeded');
    expect(finished?.tedCriteriaSnapshot?.mode).toBe('qualitative');
    expect(finished?.tedCriteriaSnapshot?.programs).toHaveLength(2);
  });
  it('confirms human result separately and makes identical retries idempotent', async () => {
    const run = await Analysis.findOne({ caseId });
    const key = randomUUID(),
      body = {
        revision: 1,
        decisionVersion: 0,
        analysisId: String(run!._id),
        destination: 'TED_IDEA',
        expertAreas: ['FINANCE'],
        notes: 'ตรวจหลักฐานแล้ว ยืนยันด้านการเงินและคุณสมบัติ IDEA เบื้องต้น',
      };
    await agent
      .post(`/api/cases/${caseId}/reviews`)
      .set(headers)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    await agent
      .post(`/api/cases/${caseId}/reviews`)
      .set(headers)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(await Review.countDocuments({ caseId })).toBe(1);
    await agent
      .post(`/api/cases/${caseId}/reviews`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(409);
  });
  it('updates revision with audit and rejects stale input/result confirmation', async () => {
    const oldRun = await Analysis.findOne({ caseId });
    await agent
      .put(`/api/cases/${caseId}`)
      .set(headers)
      .send({ revision: 1, input: { ...input, title: 'กิจการแก้ไข' } })
      .expect(200);
    await agent
      .put(`/api/cases/${caseId}`)
      .set(headers)
      .send({ revision: 1, input })
      .expect(409);
    await agent
      .post(`/api/cases/${caseId}/reviews`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({
        revision: 2,
        decisionVersion: 1,
        analysisId: String(oldRun!._id),
        destination: null,
        expertAreas: ['FINANCE'],
        notes: 'ผลเก่า',
      })
      .expect(409);
    expect(
      await AuditEvent.countDocuments({
        caseId,
        action: { $regex: 'แก้ข้อมูล' },
      }),
    ).toBe(1);
  });
  it('stores failure truthfully and unlocks retry after provider error', async () => {
    await agent
      .post(`/api/cases/${caseId}/analyses`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 2 })
      .expect(202);
    await processNextAnalysis({
      name: 'OpenAI',
      analyze: async () => {
        throw new Error('secret provider payload must not leak');
      },
    });
    const run = await Analysis.findOne({ caseId, inputRevision: 2 });
    expect(run?.status).toBe('failed');
    expect(run?.error).not.toContain('secret');
    expect((await ScoutingCase.findById(caseId))?.activeAnalysisId).toBeNull();
  });
  it('recovers expired worker lease without pretending the job succeeded', async () => {
    const response = await agent
      .post(`/api/cases/${caseId}/analyses`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 2 })
      .expect(202);
    const runId = response.body.analysis._id;
    await Analysis.updateOne(
      { _id: runId },
      { $set: { status: 'running', leaseUntil: new Date(0) } },
    );
    await processNextAnalysis(fixtureProvider);
    expect((await Analysis.findById(runId))?.status).toBe('failed');
    expect((await ScoutingCase.findById(caseId))?.activeAnalysisId).toBeNull();
  });
  it('allows exactly one of two concurrent reviewers to confirm', async () => {
    const created = await agent
      .post('/api/cases')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, title: 'เคสทดสอบพร้อมกัน' })
      .expect(201);
    const id = created.body.caseRecord._id;
    const queued = await agent
      .post(`/api/cases/${id}/analyses`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 1 })
      .expect(202);
    await processNextAnalysis(fixtureProvider);
    const body = {
      revision: 1,
      decisionVersion: 0,
      analysisId: queued.body.analysis._id,
      destination: null,
      expertAreas: ['FINANCE'],
      notes: 'ตรวจพร้อมกัน',
    };
    const results = await Promise.all([
      agent
        .post(`/api/cases/${id}/reviews`)
        .set(headers)
        .set('Idempotency-Key', randomUUID())
        .send(body),
      agent
        .post(`/api/cases/${id}/reviews`)
        .set(headers)
        .set('Idempotency-Key', randomUUID())
        .send(body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await Review.countDocuments({ caseId: id })).toBe(1);
    expect((await ScoutingCase.findById(id))?.decisionVersion).toBe(1);
  });
  it('does not call a provider after AI permission was withdrawn while queued', async () => {
    const created = await agent
      .post('/api/cases')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, title: 'เคสถอนขอบเขต AI' })
      .expect(201);
    const id = created.body.caseRecord._id;
    const queued = await agent
      .post(`/api/cases/${id}/analyses`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 1 })
      .expect(202);
    await agent
      .put(`/api/cases/${id}`)
      .set(headers)
      .send({ revision: 1, input: { ...input, allowAiProcessing: false } })
      .expect(200);
    let calls = 0;
    await processNextAnalysis({
      name: 'OpenAI',
      analyze: async () => {
        calls++;
        return fixtureProvider.analyze();
      },
    });
    expect(calls).toBe(0);
    expect((await Analysis.findById(queued.body.analysis._id))?.status).toBe(
      'failed',
    );
  });
  it('persists Groq attribution through queue, worker, human review and case history', async () => {
    const groqConfig: Config = {
      ...config,
      aiProvider: 'groq',
      aiModel: 'groq-fixture-model',
    };
    const groqAgent = request.agent(createApp(groqConfig));
    await groqAgent
      .post('/api/auth/login')
      .set(headers)
      .send({ email: 'officer@example.test', password: 'Test-password-2026' })
      .expect(200);
    const catalog = await groqAgent.get('/api/catalog').expect(200);
    expect(catalog.body.aiProvider).toBe('groq');
    expect(JSON.stringify(catalog.body)).not.toContain(config.aiKey);
    const created = await groqAgent
      .post('/api/cases')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, title: 'Groq fixture workflow' })
      .expect(201);
    const id = created.body.caseRecord._id;
    const queued = await groqAgent
      .post(`/api/cases/${id}/analyses`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 1 })
      .expect(202);
    expect(queued.body.analysis).toMatchObject({
      provider: 'Groq',
      model: 'groq-fixture-model',
    });
    await processNextAnalysis({ ...fixtureProvider, name: 'Groq' });
    await groqAgent
      .post(`/api/cases/${id}/reviews`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({
        revision: 1,
        decisionVersion: 0,
        analysisId: queued.body.analysis._id,
        destination: null,
        expertAreas: ['FINANCE'],
        notes: 'ตรวจผล fixture ด้านการเงินแล้ว',
      })
      .expect(201);
    const detail = await groqAgent.get(`/api/cases/${id}`).expect(200);
    expect(detail.body.analyses[0]).toMatchObject({
      provider: 'Groq',
      model: 'groq-fixture-model',
      status: 'succeeded',
    });
    expect(detail.body.reviews).toHaveLength(1);
    expect(detail.body.events.length).toBeGreaterThanOrEqual(3);
  });
  it('fails a queued job safely if the running adapter changed providers', async () => {
    const created = await agent
      .post('/api/cases')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, title: 'Provider switch fixture' })
      .expect(201);
    const id = created.body.caseRecord._id;
    const queued = await agent
      .post(`/api/cases/${id}/analyses`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 1 })
      .expect(202);
    let calls = 0;
    await processNextAnalysis({
      name: 'Groq',
      analyze: async () => {
        calls++;
        return fixtureProvider.analyze();
      },
    });
    expect(calls).toBe(0);
    expect((await Analysis.findById(queued.body.analysis._id))?.status).toBe(
      'failed',
    );
    expect((await ScoutingCase.findById(id))?.activeAnalysisId).toBeNull();
  });
  it('rejects oversized JSON before database mutation', async () => {
    await agent
      .post('/api/cases')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, title: 'x'.repeat(160000) })
      .expect(413);
  });
  it('allows officer TED override while preserving UBI/TBI gates and historical snapshots', async () => {
    const created = await agent
      .post('/api/cases')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...input,
        title: 'TED qualitative integration',
        answers: {
          B1: 'ปัญหาลูกค้า',
          D3: 'ยังไม่ทราบ',
          A5: 1,
          A6: 'ยังไม่จดทะเบียน',
          thaiShares: 0,
        },
      })
      .expect(201);
    const id = created.body.caseRecord._id;
    const queued = await agent
      .post(`/api/cases/${id}/analyses`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 1 })
      .expect(202);
    await processNextAnalysis(fixtureProvider);
    const run = await Analysis.findOne({ caseId: id });
    const body = {
      revision: 1,
      decisionVersion: 0,
      analysisId: String(run!._id),
      expertAreas: [],
      notes: 'เจ้าหน้าที่ตรวจหลักฐานแล้ว เลือก POC ต่างจาก AI ที่ยังไม่สรุป',
    };
    for (const destination of ['UBI_PRE', 'TBI']) {
      await agent
        .post(`/api/cases/${id}/reviews`)
        .set(headers)
        .set('Idempotency-Key', randomUUID())
        .send({ ...body, destination })
        .expect(400);
    }
    await agent
      .post(`/api/cases/${id}/reviews`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, destination: 'TED_POC', notes: '' })
      .expect(400);
    await agent
      .post(`/api/cases/${id}/reviews`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, destination: 'TED_POC' })
      .expect(201);
    const detail = await agent.get(`/api/cases/${id}`).expect(200);
    expect(detail.body.analyses[0].result.tedAssessment.classification).toBe(
      'INSUFFICIENT_DATA',
    );
    expect(detail.body.reviews[0].destination).toBe('TED_POC');
    expect(detail.body.analyses[0].tedCriteriaSnapshot).toEqual(
      run!.tedCriteriaSnapshot,
    );
    expect(queued.body).toBeTruthy();
    // A previous-version result remains in history but cannot authorize a new review.
    await Analysis.updateOne(
      { _id: run!._id },
      { $set: { ruleVersion: 'historical-rule' } },
    );
    await agent
      .post(`/api/cases/${id}/reviews`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, decisionVersion: 1, destination: 'TED_IDEA' })
      .expect(409);
    expect(
      (await agent.get(`/api/cases/${id}`).expect(200)).body.analyses[0]
        .ruleVersion,
    ).toBe('historical-rule');
  });
  it('fails old queued work before calling the provider after criteria change', async () => {
    const created = await agent
      .post('/api/cases')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(201);
    const id = created.body.caseRecord._id;
    await agent
      .post(`/api/cases/${id}/analyses`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 1 })
      .expect(202);
    await Analysis.updateOne(
      { caseId: id },
      { $set: { promptVersion: 'old-prompt' } },
    );
    let called = false;
    await processNextAnalysis({
      ...fixtureProvider,
      analyze: async () => {
        called = true;
        return fixtureProvider.analyze();
      },
    });
    expect(called).toBe(false);
    expect((await Analysis.findOne({ caseId: id }))?.status).toBe('failed');
    expect((await ScoutingCase.findById(id))?.activeAnalysisId).toBeNull();
  });
  it('persists stage and pending POC contribution separately with no new form fields', async () => {
    const answers = {
      C2: 'มีต้นแบบ ทดสอบกับผู้ใช้จริง',
      D1: 'ผลทดสอบผู้ใช้เบื้องต้น',
      D2: 'ยังไม่มีรายได้',
      D5: 'ร่วมลงทุนได้บางส่วน',
    };
    const created = await outsider
      .post('/api/cases')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, answers })
      .expect(201);
    const id = created.body.caseRecord._id;
    await outsider
      .post(`/api/cases/${id}/analyses`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 1 })
      .expect(202);
    await processNextAnalysis({
      name: 'OpenAI',
      analyze: async (run: AnalysisData) => ({
        requestId: null,
        result: validateAiResult(
          {
            summary: 'ต้นแบบที่เตรียมสร้างรายได้แรก',
            tedAssessment: {
              classification: 'TED_POC',
              reason: 'มีต้นแบบและหลักฐานทดสอบเริ่มต้น',
              alternativeReason: 'มีหลักฐานพัฒนาเกินแนวคิด',
              evidenceRefs: ['C2', 'D1'],
              uncertainties: ['ต้องตรวจรายละเอียดแผนรายได้'],
              developmentStage: {
                stage: 'WORKING_PROTOTYPE',
                reason: 'มีรายงานต้นแบบและผลทดสอบ',
                evidenceRefs: ['C2', 'D1'],
              },
            },
            programRecommendations: [],
            expertRecommendations: [],
            missingInformation: [{ scope: 'TED_POC_FUNDING', question: 'ขอจำนวนเงินสมทบและฐานคำนวณสำหรับ POC' }],
          },
          run,
        ),
      }),
    });
    const detail = await outsider.get(`/api/cases/${id}`).expect(200);
    expect(detail.body.analyses[0].result.tedAssessment).toMatchObject({
      classification: 'TED_POC',
      developmentStage: { stage: 'WORKING_PROTOTYPE' },
      fundingReadiness: { status: 'NEEDS_VERIFICATION', evidenceRefs: ['D5'] },
    });
    expect(detail.body.caseRecord.input.answers).toEqual(answers);
    expect(detail.body.analyses[0].result.followUps).toEqual([{ scope: 'TED_POC_FUNDING', question: 'ขอจำนวนเงินสมทบและฐานคำนวณสำหรับ POC' }]);
    expect(detail.body.analyses[0].result.missingInformation).toEqual(['ขอจำนวนเงินสมทบและฐานคำนวณสำหรับ POC']);
    expect(
      detail.body.analyses[0].tedCriteriaSnapshot.stageGuidance.length,
    ).toBeGreaterThan(0);
  });
  it('revokes token on logout', async () => {
    await agent.post('/api/auth/logout').set(headers).send({}).expect(204);
    await agent.get('/api/cases').expect(401);
  });
  it('keeps unknown-account errors generic and rate limits repeated login attempts', async () => {
    const responses = [];
    for (let i = 0; i < 11; i++)
      responses.push(
        await request(app)
          .post('/api/auth/login')
          .set(headers)
          .send({ email: 'unknown@example.test', password: 'wrong-password' }),
      );
    expect(responses[0]!.status).toBe(401);
    expect(responses.some((r) => r.status === 429)).toBe(true);
    expect(responses.every((r) => [401, 429].includes(r.status))).toBe(true);
  });
});
