import { Router } from 'express';
import { tedCriteria } from '../domain/ted-criteria.js';
import { authController } from '../controllers/auth.controller.js';
import { caseController } from '../controllers/case.controller.js';
import { authentication } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';
import {
  fields,
  experts,
  programs,
  RULE_VERSION,
  EXPERT_VERSION,
} from '../domain/catalog.js';
import type { Config } from '../config/env.js';
export function apiRoutes(config: Config) {
  const api = Router(),
    auth = authController(config),
    cases = caseController(config);
  api.post('/auth/login', rateLimit('login', 10, 15 * 60 * 1000), auth.login);
  api.use(authentication(config));
  api.use(rateLimit('api', 300, 60 * 1000));
  api.get('/auth/me', auth.me);
  api.post('/auth/logout', auth.logout);
  api.get('/catalog', (_req, res) =>
    res.json({
      fields,
      experts,
      programs,
      tedCriteria,
      ruleVersion: RULE_VERSION,
      expertVersion: EXPERT_VERSION,
      rulesApproval: 'draft',
      aiProvider: config.aiProvider,
      aiConfigured: Boolean(config.aiKey && config.aiModel),
    }),
  );
  api.get('/cases', cases.list);
  api.post('/cases', cases.create);
  api.get('/cases/:id', cases.get);
  api.put('/cases/:id', cases.update);
  api.post(
    '/cases/:id/analyses',
    rateLimit('analysis', 20, 60 * 60 * 1000),
    cases.analyze,
  );
  api.post('/cases/:id/reviews', cases.review);
  api.get('/cases/:id/history', cases.history);
  return api;
}
