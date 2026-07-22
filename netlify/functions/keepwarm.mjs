// Pings the Render app every 10 minutes so the free-tier instance rarely sleeps.
// Delete this once the service is on the paid always-on plan.
export default async () => {
  try {
    await fetch('https://freshaf.onrender.com/api/pricing', { signal: AbortSignal.timeout(60000) });
  } catch {
    // best effort — a failed ping just means the next one wakes it
  }
  return new Response('ok');
};

export const config = { schedule: '*/10 * * * *' };
