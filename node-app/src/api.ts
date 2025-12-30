export type Employee = {
  id: number;
  name: string;
  active: boolean;
  color: string | null;
  max_work_days_per_month: number;
  max_consecutive_work_days: number;
  can_work_night: boolean;
  night_only: boolean;
  special_requirements: string | null;
};

export type ShiftType = {
  id: number;
  code: string;
  name: string;
  start_time: string | null;
  end_time: string | null;
  is_work: boolean;
};

export type Assignment = {
  employee_id: number;
  day: string; // YYYY-MM-DD
  shift_type_id: number;
  shift_code: string;
  shift_name: string;
  note: string | null;
};

function normalizeBaseUrl(raw: string): string {
  // - "/api"（本機 dev proxy / 同網域部署）
  // - "https://xxx.onrender.com"（Render：前端 static site -> 後端 web service）
  const trimmed = raw.trim();
  if (!trimmed) return "/api";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

const apiBase = normalizeBaseUrl((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api");

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, init);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API 失敗 ${res.status}: ${txt || res.statusText}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listEmployees: () => http<Employee[]>("/employees"),
  createEmployee: (payload: {
    name: string;
    color?: string | null;
    max_work_days_per_month?: number;
    max_consecutive_work_days?: number;
    can_work_night?: boolean;
    night_only?: boolean;
    special_requirements?: string | null;
  }) =>
    http<Employee>("/employees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  patchEmployee: (
    id: number,
    patch: Partial<
      Pick<
        Employee,
        | "name"
        | "active"
        | "color"
        | "max_work_days_per_month"
        | "max_consecutive_work_days"
        | "can_work_night"
        | "night_only"
        | "special_requirements"
      >
    >,
  ) =>
    http<Employee>(`/employees/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  deleteEmployee: (id: number) =>
    fetch(`${apiBase}/employees/${id}`, { method: "DELETE" }).then(() => undefined),

  listShiftTypes: () => http<ShiftType[]>("/shift-types"),

  listAssignments: (month: string) => http<Assignment[]>(`/assignments?month=${encodeURIComponent(month)}`),
  upsertAssignment: (employee_id: number, day: string, shift_type_id: number | null) =>
    http<{ ok: boolean }>(`/assignments`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ employee_id, day, shift_type_id }),
    }),

  generate: (
    month: string,
    payload: {
      weekday_morning: number;
      weekday_evening: number;
      weekday_night: number;

      holiday_morning: number;
      holiday_evening: number;
      holiday_night: number;

      weekend_as_holiday: boolean;
      holiday_dates: string[]; // YYYY-MM-DD

      overwrite: boolean;
      trim_overstaff_to_off: boolean;
      prefer_clustered_work: boolean;
      prefer_same_shift_within_block: boolean;
      min_rest_days_per_7: number;
      max_consecutive_work_days: number;
    },
  ) =>
    http<{ ok: boolean; created: number; deleted: number; warnings: string[] }>(
      `/schedule/generate?month=${encodeURIComponent(month)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),

  fillOff: (month: string, payload?: { active_only?: boolean }) =>
    http<{ ok: boolean; created: number; warnings: string[] }>(`/schedule/fill-off?month=${encodeURIComponent(month)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active_only: payload?.active_only ?? true }),
    }),
};


