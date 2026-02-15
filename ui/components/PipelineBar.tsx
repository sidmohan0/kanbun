interface Props {
  stages: string[];
  counts: Record<string, number>;
}

export function PipelineBar({ stages, counts }: Props) {
  return (
    <div class="pipeline">
      {stages.map(stage => (
        <div class="stage" key={stage}>
          <div class="stage-name">{stage}</div>
          <div class="stage-count">{counts[stage] ?? 0}</div>
        </div>
      ))}
    </div>
  );
}
