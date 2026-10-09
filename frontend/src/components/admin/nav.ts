import type { Icon } from "@phosphor-icons/react";
import {
  ChartBarIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
  PathIcon,
  SquaresFourIcon,
  SteeringWheelIcon,
  TimerIcon,
  UserGearIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  CarIcon,
} from "@phosphor-icons/react";

import type { NavKey } from "./nav-meta";

export type NavItem = { key: NavKey; href: string; icon: Icon; phase2?: boolean };

export const MAIN_NAV: NavItem[] = [
  { key: "dashboard", href: "/admin", icon: SquaresFourIcon },
  { key: "trips", href: "/admin/trips", icon: PathIcon },
  { key: "cars", href: "/admin/cars", icon: CarIcon },
  { key: "drivers", href: "/admin/drivers", icon: SteeringWheelIcon },
  { key: "passengers", href: "/admin/passengers", icon: UsersThreeIcon },
  { key: "reports", href: "/admin/reports", icon: ChartBarIcon },
  { key: "alerts", href: "/admin/alerts", icon: WarningCircleIcon },
  { key: "audit", href: "/admin/audit", icon: ClockCounterClockwiseIcon },
  { key: "overtime", href: "/admin/overtime", icon: TimerIcon, phase2: true },
];

export const FOOT_NAV: NavItem[] = [
  { key: "users", href: "/admin/users", icon: UserGearIcon },
  { key: "settings", href: "/admin/settings", icon: GearSixIcon },
];

export function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}
