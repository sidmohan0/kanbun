import { useState, useEffect } from "preact/hooks";

interface Props {
  projectId: number;
  projectName: string;
  onBack: () => void;
}

type Scenario = "conservative" | "base" | "aggressive";

interface Projection {
  week: number;
  phase: string;
  newUsers: number;
  totalUsers: number;
  mrr: number;
  conversionRate: number;
}

interface Actual {
  week: number;
  weekStart: string;
  contactsAdded: number;
  emailsSent: number;
  replies: number;
  meetings: number;
}

interface GtmConfig {
  phases: {
    name: string;
    weeks: number;
    weeklyGrowthRate: number;
    conversionRate: number;
    channels: { name: string; percentage: number }[];
    weeklyTargets: { outreach: number; meetings: number; demos: number };
  }[];
  initialUsers: number;
  pricePerUser: number;
  userMilestones: { label: string; value: number }[];
  revenueMilestones: { label: string; value: number }[];
  scenarioMultipliers: Record<Scenario, number>;
}

export function GtmDashboard({ projectId, projectName, onBack }: Props) {
  const [config, setConfig] = useState<GtmConfig | null>(null);
  const [scenario, setScenario] = useState<Scenario>("base");
  const [projections, setProjections] = useState<Projection[]>([]);
  const [actuals, setActuals] = useState<Actual[]>([]);
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [editConfig, setEditConfig] = useState<GtmConfig | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/gtm/config`)
      .then((r) => r.json())
      .then(setConfig);
    fetch(`/api/projects/${projectId}/gtm/actuals`)
      .then((r) => r.json())
      .then(setActuals);
  }, [projectId]);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/gtm/projections?scenario=${scenario}`)
      .then((r) => r.json())
      .then(setProjections);
  }, [projectId, scenario]);

  if (!config) return null;

  const totalWeeks = config.phases.reduce((s, p) => s + p.weeks, 0);
  const finalProjection = projections[projections.length - 1];

  // Milestone progress
  function getMilestoneStatus(
    milestones: { label: string; value: number }[],
    currentValue: number
  ) {
    return milestones.map((m) => ({
      ...m,
      reached: currentValue >= m.value,
      progress: Math.min(100, (currentValue / m.value) * 100),
    }));
  }

  const currentUsers = finalProjection?.totalUsers ?? config.initialUsers;
  const currentMrr = finalProjection?.mrr ?? 0;
  const userMilestones = getMilestoneStatus(config.userMilestones, currentUsers);
  const revenueMilestones = getMilestoneStatus(config.revenueMilestones, currentMrr);

  // Summary stats from actuals
  const totalContactsAdded = actuals.reduce((s, a) => s + a.contactsAdded, 0);
  const totalEmailsSent = actuals.reduce((s, a) => s + a.emailsSent, 0);
  const totalReplies = actuals.reduce((s, a) => s + a.replies, 0);
  const totalMeetings = actuals.reduce((s, a) => s + a.meetings, 0);

  function handleSaveConfig() {
    if (!editConfig) return;
    fetch(`/api/projects/${projectId}/gtm/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editConfig),
    })
      .then((r) => r.json())
      .then(() => {
        setConfig(editConfig);
        setEditing(false);
        // Reload projections
        fetch(
          `/api/projects/${projectId}/gtm/projections?scenario=${scenario}`
        )
          .then((r) => r.json())
          .then(setProjections);
      });
  }

  return (
    <div class="gtm-page">
      <div class="gtm-header">
        <div>
          <button onClick={onBack} class="btn" style="margin-right:12px">
            ← Back
          </button>
          <span class="gtm-title">{projectName} — Growth Model</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <div class="scenario-picker">
            {(["conservative", "base", "aggressive"] as Scenario[]).map(
              (s) => (
                <button
                  key={s}
                  class={`scenario-btn ${scenario === s ? "active" : ""}`}
                  onClick={() => setScenario(s)}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              )
            )}
          </div>
          <button
            class="btn"
            onClick={() => {
              setEditConfig(JSON.parse(JSON.stringify(config)));
              setEditing(!editing);
            }}
          >
            {editing ? "Cancel" : "Configure"}
          </button>
        </div>
      </div>

      {editing && editConfig && (
        <div class="gtm-config-editor">
          <h3>Growth Model Configuration</h3>
          <div class="config-row">
            <label class="field-label">Initial Users</label>
            <input
              type="number"
              value={editConfig.initialUsers}
              onInput={(e) =>
                setEditConfig({
                  ...editConfig,
                  initialUsers: Number((e.target as HTMLInputElement).value),
                })
              }
              class="config-input"
            />
            <label class="field-label">Price Per User ($)</label>
            <input
              type="number"
              value={editConfig.pricePerUser}
              onInput={(e) =>
                setEditConfig({
                  ...editConfig,
                  pricePerUser: Number((e.target as HTMLInputElement).value),
                })
              }
              class="config-input"
            />
          </div>
          {editConfig.phases.map((phase, pi) => (
            <div key={pi} class="config-phase">
              <div class="config-phase-header">{phase.name}</div>
              <div class="config-row">
                <label class="field-label">Weeks</label>
                <input
                  type="number"
                  value={phase.weeks}
                  onInput={(e) => {
                    const phases = [...editConfig.phases];
                    phases[pi] = {
                      ...phases[pi],
                      weeks: Number((e.target as HTMLInputElement).value),
                    };
                    setEditConfig({ ...editConfig, phases });
                  }}
                  class="config-input config-input-sm"
                />
                <label class="field-label">Growth Rate</label>
                <input
                  type="number"
                  step="0.01"
                  value={phase.weeklyGrowthRate}
                  onInput={(e) => {
                    const phases = [...editConfig.phases];
                    phases[pi] = {
                      ...phases[pi],
                      weeklyGrowthRate: Number(
                        (e.target as HTMLInputElement).value
                      ),
                    };
                    setEditConfig({ ...editConfig, phases });
                  }}
                  class="config-input config-input-sm"
                />
                <label class="field-label">Conversion</label>
                <input
                  type="number"
                  step="0.01"
                  value={phase.conversionRate}
                  onInput={(e) => {
                    const phases = [...editConfig.phases];
                    phases[pi] = {
                      ...phases[pi],
                      conversionRate: Number(
                        (e.target as HTMLInputElement).value
                      ),
                    };
                    setEditConfig({ ...editConfig, phases });
                  }}
                  class="config-input config-input-sm"
                />
              </div>
              <div class="config-row">
                <label class="field-label">Weekly Outreach</label>
                <input
                  type="number"
                  value={phase.weeklyTargets.outreach}
                  onInput={(e) => {
                    const phases = [...editConfig.phases];
                    phases[pi] = {
                      ...phases[pi],
                      weeklyTargets: {
                        ...phases[pi].weeklyTargets,
                        outreach: Number(
                          (e.target as HTMLInputElement).value
                        ),
                      },
                    };
                    setEditConfig({ ...editConfig, phases });
                  }}
                  class="config-input config-input-sm"
                />
                <label class="field-label">Meetings</label>
                <input
                  type="number"
                  value={phase.weeklyTargets.meetings}
                  onInput={(e) => {
                    const phases = [...editConfig.phases];
                    phases[pi] = {
                      ...phases[pi],
                      weeklyTargets: {
                        ...phases[pi].weeklyTargets,
                        meetings: Number(
                          (e.target as HTMLInputElement).value
                        ),
                      },
                    };
                    setEditConfig({ ...editConfig, phases });
                  }}
                  class="config-input config-input-sm"
                />
                <label class="field-label">Demos</label>
                <input
                  type="number"
                  value={phase.weeklyTargets.demos}
                  onInput={(e) => {
                    const phases = [...editConfig.phases];
                    phases[pi] = {
                      ...phases[pi],
                      weeklyTargets: {
                        ...phases[pi].weeklyTargets,
                        demos: Number(
                          (e.target as HTMLInputElement).value
                        ),
                      },
                    };
                    setEditConfig({ ...editConfig, phases });
                  }}
                  class="config-input config-input-sm"
                />
              </div>
            </div>
          ))}
          <div class="config-actions">
            <button class="btn btn-secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button class="btn btn-primary" onClick={handleSaveConfig}>
              Save Configuration
            </button>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div class="gtm-summary">
        <div class="gtm-card">
          <div class="gtm-card-label">Projected Users</div>
          <div class="gtm-card-value">
            {currentUsers.toLocaleString()}
          </div>
          <div class="gtm-card-sub">
            over {totalWeeks} weeks ({scenario})
          </div>
        </div>
        <div class="gtm-card">
          <div class="gtm-card-label">Projected MRR</div>
          <div class="gtm-card-value">
            ${currentMrr.toLocaleString()}
          </div>
          <div class="gtm-card-sub">
            at ${config.pricePerUser}/user
          </div>
        </div>
        <div class="gtm-card">
          <div class="gtm-card-label">Actual Outreach</div>
          <div class="gtm-card-value">{totalContactsAdded}</div>
          <div class="gtm-card-sub">
            contacts added ({actuals.length} weeks)
          </div>
        </div>
        <div class="gtm-card">
          <div class="gtm-card-label">Activity</div>
          <div class="gtm-card-value">{totalEmailsSent}</div>
          <div class="gtm-card-sub">
            sent · {totalReplies} replies · {totalMeetings} meetings
          </div>
        </div>
      </div>

      {/* Milestones */}
      <div class="gtm-milestones-row">
        <div class="gtm-milestones-section">
          <h3>User Milestones</h3>
          <div class="milestones-list">
            {userMilestones.map((m) => (
              <div key={m.label} class="milestone-item">
                <span class={`milestone-dot ${m.reached ? "reached" : ""}`} />
                <span class="milestone-label">{m.label}</span>
                <div class="milestone-bar">
                  <div
                    class="milestone-fill"
                    style={`width:${Math.min(100, m.progress)}%`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div class="gtm-milestones-section">
          <h3>Revenue Milestones</h3>
          <div class="milestones-list">
            {revenueMilestones.map((m) => (
              <div key={m.label} class="milestone-item">
                <span class={`milestone-dot ${m.reached ? "reached" : ""}`} />
                <span class="milestone-label">{m.label}</span>
                <div class="milestone-bar">
                  <div
                    class="milestone-fill revenue"
                    style={`width:${Math.min(100, m.progress)}%`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Phase Cards */}
      <h3 class="gtm-section-title">Phases</h3>
      <div class="gtm-phases">
        {config.phases.map((phase, i) => {
          const phaseStart =
            config.phases
              .slice(0, i)
              .reduce((s, p) => s + p.weeks, 0) + 1;
          const phaseEnd = phaseStart + phase.weeks - 1;
          const phaseProjections = projections.filter(
            (p) => p.phase === phase.name
          );
          const phaseActuals = actuals.filter(
            (a) => a.week >= phaseStart && a.week <= phaseEnd
          );
          const expanded = expandedPhase === i;

          return (
            <div key={i} class="gtm-phase-card">
              <div
                class="gtm-phase-header"
                onClick={() =>
                  setExpandedPhase(expanded ? null : i)
                }
              >
                <div>
                  <span class="gtm-phase-name">{phase.name}</span>
                  <span class="gtm-phase-weeks">
                    Weeks {phaseStart}-{phaseEnd}
                  </span>
                </div>
                <div class="gtm-phase-stats">
                  <span>
                    {(phase.weeklyGrowthRate * 100).toFixed(0)}% growth
                  </span>
                  <span>
                    {(phase.conversionRate * 100).toFixed(0)}% conv.
                  </span>
                  <span>{expanded ? "▲" : "▼"}</span>
                </div>
              </div>

              {expanded && (
                <div class="gtm-phase-detail">
                  <div class="gtm-phase-channels">
                    <h4>Channel Mix</h4>
                    {phase.channels.map((ch) => (
                      <div key={ch.name} class="channel-row">
                        <span>{ch.name}</span>
                        <div class="channel-bar">
                          <div
                            class="channel-fill"
                            style={`width:${ch.percentage}%`}
                          />
                        </div>
                        <span class="channel-pct">
                          {ch.percentage}%
                        </span>
                      </div>
                    ))}
                  </div>
                  <div class="gtm-phase-targets">
                    <h4>Weekly Targets</h4>
                    <div class="targets-grid">
                      <div class="target-item">
                        <div class="target-value">
                          {phase.weeklyTargets.outreach}
                        </div>
                        <div class="target-label">Outreach</div>
                      </div>
                      <div class="target-item">
                        <div class="target-value">
                          {phase.weeklyTargets.meetings}
                        </div>
                        <div class="target-label">Meetings</div>
                      </div>
                      <div class="target-item">
                        <div class="target-value">
                          {phase.weeklyTargets.demos}
                        </div>
                        <div class="target-label">Demos</div>
                      </div>
                    </div>
                  </div>

                  {/* Weekly breakdown table */}
                  <div class="gtm-weekly-table">
                    <h4>Weekly Breakdown (Projected vs Actual)</h4>
                    <table>
                      <thead>
                        <tr>
                          <th>Week</th>
                          <th>New (proj)</th>
                          <th>Total (proj)</th>
                          <th>MRR (proj)</th>
                          <th>Contacts (actual)</th>
                          <th>Emails (actual)</th>
                          <th>Replies (actual)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {phaseProjections.map((p) => {
                          const actual = phaseActuals.find(
                            (a) => a.week === p.week
                          );
                          return (
                            <tr key={p.week}>
                              <td>{p.week}</td>
                              <td>{p.newUsers}</td>
                              <td>{p.totalUsers.toLocaleString()}</td>
                              <td>${p.mrr.toLocaleString()}</td>
                              <td
                                class={
                                  actual
                                    ? actual.contactsAdded > 0
                                      ? "actual-good"
                                      : "actual-zero"
                                    : "actual-future"
                                }
                              >
                                {actual ? actual.contactsAdded : "—"}
                              </td>
                              <td
                                class={
                                  actual
                                    ? actual.emailsSent > 0
                                      ? "actual-good"
                                      : "actual-zero"
                                    : "actual-future"
                                }
                              >
                                {actual ? actual.emailsSent : "—"}
                              </td>
                              <td
                                class={
                                  actual
                                    ? actual.replies > 0
                                      ? "actual-good"
                                      : "actual-zero"
                                    : "actual-future"
                                }
                              >
                                {actual ? actual.replies : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
