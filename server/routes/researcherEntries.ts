import express from 'express';
import { sendCachedEntries, sendEntriesFromCache } from '../services/cache';
import { researcherList } from '../services/entryLists';
import { readListFilters } from '../services/listFilters';
import { sendError } from '../services/utils';

/** GET /api/entries/researchers: the researcher list under the sidebar's filters. The queries are in services/entryLists.ts. */
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    if (sendEntriesFromCache(req, res)) return;
    sendCachedEntries(req, res, researcherList(await readListFilters(req.query as Record<string, unknown>)));
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
