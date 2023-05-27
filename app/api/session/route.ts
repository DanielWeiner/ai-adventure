import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
 
export function GET(req: NextRequest) {
    return NextResponse.json({
        sessionToken: cookies().get('next-auth.session-token')?.value,
        csrfToken: cookies().get('next-auth.csrf-token')?.value
    });
}