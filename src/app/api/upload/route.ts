import { NextRequest, NextResponse } from 'next/server.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

import { callerOf } from '../../../lib/late-plate-api.ts';

export async function POST(request: NextRequest) {
  const caller = await callerOf(request);
  if (caller.session?.role !== 'admin' && !caller.device) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const dataUrl = body?.dataUrl || '';
    
    const match = /^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) {
      return NextResponse.json({ error: 'Expected a base64 image data URL' }, { status: 400 });
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buf = Buffer.from(match[2], 'base64');
    
    if (buf.length > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image too large' }, { status: 413 });
    }

    const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    
    return NextResponse.json({ url: '/uploads/' + name });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process upload' }, { status: 500 });
  }
}
