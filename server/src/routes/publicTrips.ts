import express, { Request, Response } from 'express';
import { getPublicTripData } from '../services/publicTripService';

const router = express.Router();

router.get('/:id', (req: Request, res: Response) => {
  const data = getPublicTripData(req.params.id);
  if (!data) return res.status(404).json({ error: 'Trip not found' });
  res.json(data);
});

export default router;
