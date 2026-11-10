import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/db';
import { defaultProject } from '../src/modules/ingest';
import { runDetection } from '../src/modules/anomaly';
import { seedHistory } from '../src/modules/simulator';

async function main() {
  const p = await defaultProject();
  await prisma.user.upsert({ where: { email: 'admin@traceweaver.dev' }, update: {}, create: { email: 'admin@traceweaver.dev', name: 'Demo Admin', passwordHash: await bcrypt.hash('traceweaver', 12) } });
  await prisma.dataSource.upsert({ where: { projectId_name: { projectId: p.id, name: 'Demo REST source' } }, update: {}, create: { projectId: p.id, name: 'Demo REST source', description: 'Default source for REST ingestion' } });
  if ((await prisma.trace.count()) === 0) {
    await seedHistory();
    // Run detection across the historical incident window.
    const inc = Date.now() - 0.5 * 3600_000;
    await runDetection(new Date(inc), 5, 30);
  }
  console.log('Seed complete. Login: admin@traceweaver.dev / traceweaver');
}
main().finally(() => prisma.$disconnect());
