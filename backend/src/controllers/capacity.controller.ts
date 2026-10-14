import { Request, Response } from 'express';
import * as capacityService from '../services/capacity.service';

export async function sites(_req: Request, res: Response) {
  res.json({ sites: await capacityService.listSites() });
}

export async function siteSlots(req: Request, res: Response) {
  const slots = await capacityService.listSlotsForSite(req.params.id, (req.query as any).date);
  res.json({ slots });
}

export async function slot(req: Request, res: Response) {
  res.json({ slot: await capacityService.getSlot(req.params.id) });
}

export async function matrix(req: Request, res: Response) {
  res.json(await capacityService.capacityMatrix((req.query as any).date));
}

export async function createSlot(req: Request, res: Response) {
  res.status(201).json({ slot: await capacityService.createSlot(req.body) });
}
