import express, { Request, Response } from 'express';
import { getPublicTripData, getPublicTripsList } from '../services/publicTripService';

const router = express.Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(getPublicTripsList());
});

router.get('/:id', (req: Request, res: Response) => {
  const data = getPublicTripData(req.params.id);
  if (!data) return res.status(404).json({ error: 'Trip not found' });
  res.json(data);
});

export default router;
