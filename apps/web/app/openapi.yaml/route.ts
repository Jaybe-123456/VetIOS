import { NextResponse } from 'next/server';

export function GET(req: Request) {
    return NextResponse.redirect(new URL('/api/public/developer-openapi.yaml', req.url), 308);
}
