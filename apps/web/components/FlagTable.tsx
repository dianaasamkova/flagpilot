// The read-only flag table for one environment (FP-14).
import type { Environment, Flag } from "@flagpilot/domain";

export function FlagTable({ flags, env }: { flags: readonly Flag[]; env: Environment }) {
  return (
    <div className="table-wrap">
      <table className="flags">
        <caption className="visually-hidden">Flags in {env}</caption>
        <thead>
          <tr>
            <th scope="col">Flag</th>
            <th scope="col">State</th>
            <th scope="col">Regions</th>
            <th scope="col">Rollout</th>
            <th scope="col">Owner</th>
            <th scope="col">Rev.</th>
          </tr>
        </thead>
        <tbody>
          {flags.map((flag) => {
            const config = flag.envs[env];
            return (
              <tr key={flag.key}>
                <td>
                  <code>{flag.key}</code>
                  <div className="muted small">{flag.description}</div>
                  <div className="tags">
                    {flag.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={config.enabled ? "pill pill-on" : "pill pill-off"}>
                    {config.enabled ? "On" : "Off"}
                  </span>
                </td>
                <td>{config.targeting.regions.join(", ")}</td>
                <td className="num">{config.rolloutPercent}%</td>
                <td className="small">{flag.owner}</td>
                <td className="num muted">{config.revision}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
