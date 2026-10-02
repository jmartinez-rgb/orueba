"use client";
import { useState } from "react";
import { MonthGate } from "@/components/novedades/month-gate";
import { CriticalAlertGate } from "./critical-alert-gate";

/** Un solo modal operativo a la vez: los críticos tienen prioridad sobre el arranque. */
export function OperationalGates({ userName, userId, canAcknowledgeCritical, canTicket, canKickoff }: { userName: string; userId: string; canAcknowledgeCritical: boolean; canTicket: boolean; canKickoff: boolean }) {
  const [criticalOpen, setCriticalOpen] = useState(false);
  return (
    <>
      <MonthGate canKickoff={canKickoff} userId={userId} suspended={criticalOpen} />
      {canAcknowledgeCritical && <CriticalAlertGate userName={userName} canTicket={canTicket} onPendingChange={setCriticalOpen} />}
    </>
  );
}
