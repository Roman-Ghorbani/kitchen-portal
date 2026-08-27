import { NextRequest, NextResponse } from 'next/server.js';
import { getTvSettings, updateTvSettings } from '../../../lib/tv-service.ts';
import { callerOf } from '../../../lib/late-plate-api.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(request: NextRequest) {
  try {
    const config = await getTvSettings();
    
    // Strip sensitive token from the response, as the TV and admin panels shouldn't have it visible
    const safeConfig = {
      ...config,
      latePlates: {
        ...(config.latePlates || {}),
        token: '',
        tokenSet: Boolean(config.latePlates?.token)
      }
    };
    
    return NextResponse.json(safeConfig, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to load TV settings' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

export async function POST(request: NextRequest) {
  const caller = await callerOf(request);
  if (caller.session?.role !== 'admin' && !caller.device) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
  }

  try {
    const incoming = await request.json();
    
    // Handle latePlates token clearing logic
    if (incoming.latePlates && !incoming.latePlates.token && !incoming.latePlates.clearToken) {
      delete incoming.latePlates.token;
    }
    if (incoming.latePlates) {
      delete incoming.latePlates.clearToken;
      delete incoming.latePlates.tokenSet;
    }
    
    await updateTvSettings(incoming);
    
    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to update TV settings' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
