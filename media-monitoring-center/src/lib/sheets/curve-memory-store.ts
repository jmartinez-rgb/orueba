import "server-only";
import type { PlatformId } from "@/lib/types";
import { getRecordStore } from "@/lib/records/store";
import { addPoint, type CurveMemory, type IntradayDays, type IntradayPoint } from "./intraday-memory";

/** Acumulados del día guardados en el almacén de registros (Netlify Blobs o `.data/records`). */
export class RecordsCurveMemory implements CurveMemory {
  private key(platform: PlatformId) {
    return `curves/${platform}`;
  }

  async load(platform: PlatformId): Promise<IntradayDays> {
    return (await getRecordStore().get<IntradayDays>(this.key(platform))) ?? {};
  }

  async record(platform: PlatformId, date: string, point: IntradayPoint): Promise<void> {
    const store = getRecordStore();
    const days = (await store.get<IntradayDays>(this.key(platform))) ?? {};
    await store.set(this.key(platform), addPoint(days, date, point));
  }
}
