import {
  Activity,
  BellRing,
  BookOpenText,
  Bug,
  CalendarClock,
  Eye,
  GitCompareArrows,
  Gauge,
  History,
  LayoutDashboard,
  Layers,
  Lightbulb,
  Megaphone,
  MessageSquareText,
  Plug,
  RadioTower,
  Settings,
  ShieldCheck,
  Siren,
  Ticket,
  UsersRound,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/auth/roles";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "alerts" | "incidents" | "tickets" | "feedback" | "novedades";
  /** Permiso necesario (con una lista basta tener cualquiera). */
  permission?: Permission | Permission[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Monitoreo",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/live", label: "Live Monitoring", icon: RadioTower },
      { href: "/platforms", label: "Platforms", icon: Layers },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/monitoreos", label: "Monitoreos", icon: MessageSquareText },
    ],
  },
  {
    label: "Alertas",
    items: [
      { href: "/alerts", label: "Alerts", icon: BellRing, badge: "alerts" },
      { href: "/incidents", label: "Incidents", icon: Siren, badge: "incidents" },
      { href: "/tickets", label: "Tickets", icon: Ticket, badge: "tickets" },
      { href: "/novedades", label: "Novedades", icon: CalendarClock, badge: "novedades" },
    ],
  },
  {
    label: "Control",
    items: [
      { href: "/auditoria", label: "Auditoría", icon: ShieldCheck, permission: "audit:view" },
      { href: "/cliente", label: "Vista del cliente", icon: Eye, permission: "client:view" },
    ],
  },
  {
    label: "Análisis",
    items: [
      { href: "/budget", label: "Budget Control", icon: Wallet },
      { href: "/compare", label: "Compare", icon: GitCompareArrows },
      { href: "/historical", label: "Historical", icon: History },
      { href: "/metricas", label: "Métricas", icon: Gauge },
      { href: "/optimizaciones", label: "Optimizaciones", icon: Lightbulb },
    ],
  },
  {
    label: "Operación",
    items: [
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/automation", label: "Automation", icon: Workflow },
      { href: "/usuarios", label: "Usuarios y accesos", icon: UsersRound, permission: ["users:view", "users:manage"] },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
  {
    label: "Ayuda",
    items: [
      { href: "/guia", label: "Guía", icon: BookOpenText },
      { href: "/sugerencias", label: "Bugs y sugerencias", icon: Bug, badge: "feedback" },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export const BRAND_ICON = Activity;
