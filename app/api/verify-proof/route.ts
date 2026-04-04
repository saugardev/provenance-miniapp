/**
 * POST /api/verify-proof
 *
 * Verifies a World ID ZK proof (v3 or v4) against the World ID Developer API.
 * Called by the frontend immediately after the World App returns a proof,
 * before the user submits their image — so they get fast feedback.
 *
 * v3 note: orbLegacy results may omit the `action` field. We inject it from
 *   WORLDCOIN_ACTION env before forwarding, as the Developer API requires it.
 *
 * Docs: https://docs.world.org/api-reference/developer-portal/verify
 *
 * Request:  { idkitResponse: IDKitResult, rp_id?: string }  (or idkit_result as alias)
 * Response: { success: boolean, detail: unknown }
 */

import { NextResponse } from "next/server";
import { verifyIdKitResponse, extractIdkitFields, resolveWorldcoinRpId } from "../../../lib/worldcoin-verify";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  console.log("[verify-proof] request received");
  try {
    const body = await request.json().catch(() => ({}));
    const idkitResponse = body?.idkitResponse ?? body?.idkit_result;
    const requestedRpId = String(body?.rp_id ?? "").trim();
    if (!idkitResponse) {
      console.warn("[verify-proof] missing idkitResponse in request body");
      return NextResponse.json({ error: "idkitResponse is required" }, { status: 400 });
    }
    const configuredRpId = resolveWorldcoinRpId();
    if (requestedRpId && requestedRpId !== configuredRpId) {
      console.warn(`[verify-proof] rp_id mismatch requested="${requestedRpId}" configured="${configuredRpId}"`);
      return NextResponse.json(
        { error: "rp_id does not match configured relying party" },
        { status: 400 },
      );
    }

    const configuredAction = process.env.WORLDCOIN_ACTION?.trim() ?? "";
    const resultAction = String(idkitResponse?.action ?? "").trim();
    const action = resultAction || configuredAction;

    // Inject action if absent — orbLegacy (v3) IDKitResults may omit it,
    // but the World ID verify endpoint requires it for duplicate-nullifier checks.
    const payload = action ? { ...idkitResponse, action } : idkitResponse;

    console.log(`[verify-proof] forwarding to World ID API rp_id="${configuredRpId}" action="${action}" protocol_version=${(idkitResponse as any)?.protocol_version ?? "unknown"}`);
    const result = await verifyIdKitResponse(payload);

    if (result.success) {
      const { nullifier, verificationLevel } = extractIdkitFields(payload);
      console.log(`[verify-proof] ✓ verified session_id="${result.session_id}" environment="${result.environment}" nullifier="${nullifier}" level="${verificationLevel}"`);
      return NextResponse.json(
        {
          success: true,
          session_id: result.session_id,
          nullifier_hash: nullifier,
          verification_level: verificationLevel,
          detail: result.detail,
        },
        { status: 200 },
      );
    } else {
      console.warn("[verify-proof] ✗ verification failed:", JSON.stringify(result.detail));
      return NextResponse.json(
        { success: false, detail: result.detail },
        { status: 401 },
      );
    }
  } catch (err) {
    console.error("[verify-proof] unhandled error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
