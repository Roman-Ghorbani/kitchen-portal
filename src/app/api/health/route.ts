import { NextResponse } from 'next/server.js';

export async function GET() {
  return NextResponse.json({
    tvLastSeen: Date.now(),
    secondsAgo: 0,
    serverStarted: Date.now()
  });
}
