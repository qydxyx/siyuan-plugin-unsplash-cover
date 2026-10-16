/**
 * Test stub for the `siyuan` runtime package.
 *
 * The published package only resolves inside the SiYuan frontend (its `exports`
 * map has no Node condition), so vitest aliases `siyuan` to this file. Only the
 * members that the tested modules import need to exist here.
 */
import { vi } from "vitest";

export const fetchSyncPost = vi.fn();
