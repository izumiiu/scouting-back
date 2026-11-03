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
const config: Config = {
  port: 4000,
  mongoUri: '',
  jwtSecret: 'test-only-secret-longer-than-32-characters',
  origin: 'http://localhost:5173',
  production: false,
  trustProxyHops: 0,
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
  analyze: async () => ({
    result: {
      summary: 'ผลจำลองสำหรับ integration test เท่านั้น',
      programRecommendations: [],
      expertRecommendations: [
        {
          area: 'FINANCE',
          need: 'รู้ต้นทุน',
          reason: 'ยังไม่ทราบต้นทุน',
          evidenceRefs: ['D3'],
        },
      ],
      missingInformation: [],
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
    expect((await Analysis.findOne({ caseId }))?.status).toBe('succeeded');
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
  it('rejects oversized JSON before database mutation', async () => {
    await agent
      .post('/api/cases')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, title: 'x'.repeat(160000) })
      .expect(413);
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
