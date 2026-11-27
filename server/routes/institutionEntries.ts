import express from 'express';
import { sendCachedEntries, sendEntriesFromCache } from '../services/cache';
import { institutionList } from '../services/entryLists';
import { readListFilters } from '../services/listFilters';
import { sendError } from '../services/utils';

/** GET /api/entries/institutions: the institution list under the sidebar's filters. The queries are in services/entryLists.ts. */
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    if (sendEntriesFromCache(req, res)) return;
    sendCachedEntries(req, res, institutionList(await readListFilters(req.query as Record<string, unknown>)));
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
