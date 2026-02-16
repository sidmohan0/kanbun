import { useState, useEffect } from "preact/hooks";

interface Service {
  name: string;
  url: string;
}

const SERVICES: Service[] = [
  { name: "API", url: "/api/projects" },
  { name: "Apollo", url: "http://localhost:3001/health" },
];

type Status = "up" | "down" | "checking";

export function ServiceStatus() {
  const [statuses, setStatuses] = useState<Record<string, Status>>(() =>
    Object.fromEntries(SERVICES.map((s) => [s.name, "checking" as Status]))
  );

  useEffect(() => {
    function check() {
      SERVICES.forEach((svc) => {
        fetch(svc.url, { method: "GET", signal: AbortSignal.timeout(3000) })
          .then((r) => {
            setStatuses((prev) => ({ ...prev, [svc.name]: r.ok ? "up" : "down" }));
          })
          .catch(() => {
            setStatuses((prev) => ({ ...prev, [svc.name]: "down" }));
          });
      });
    }

    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div class="service-status">
      {SERVICES.map((svc) => (
        <div key={svc.name} class="service-dot-row">
          <span class={`service-dot ${statuses[svc.name]}`} />
          <span class="service-label">{svc.name}</span>
        </div>
      ))}
    </div>
  );
}
