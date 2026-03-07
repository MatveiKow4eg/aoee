import { HealthRepository } from '../repositories/healthRepository';

export class HealthService {
  constructor(private readonly repo = new HealthRepository()) {}

  async getHealth() {
    const db = await this.repo.ping();

    return {
      ok: true,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      ...db,
    };
  }
}
