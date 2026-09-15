import type { StudioStep } from '../../services/api';

interface Route {
  label: string;
  value: string;
  operator: string;
  expected: string;
  target: string;
}
export function StudioRouterEditor({
  step,
  targets,
  onChange,
}: {
  step: StudioStep;
  targets: StudioStep[];
  onChange: (config: Record<string, string>) => void;
}) {
  let routes: Route[] = [];
  try {
    routes = JSON.parse(step.config.routes || '[]') as Route[];
  } catch {
    /* Validation reports malformed imported definitions. */
  }
  const update = (index: number, change: Partial<Route>) =>
    onChange({ routes: JSON.stringify(routes.map((route, i) => (i === index ? { ...route, ...change } : route))) });
  return (
    <div className="studio-router-editor">
      <p className="studio-muted">
        Paths are checked from top to bottom. Only the first matching path runs. Use “Then go to” at the end of each
        branch to skip other branches.
      </p>
      {routes.map((route, index) => (
        <fieldset key={index}>
          <legend>Path {index + 1}</legend>
          <label className="studio-field">
            Path label
            <input value={route.label} onChange={e => update(index, { label: e.target.value })} />
          </label>
          <label className="studio-field">
            Value to check
            <input
              value={route.value}
              onChange={e => update(index, { value: e.target.value })}
              placeholder="{{message}}"
            />
          </label>
          <label className="studio-field">
            Condition
            <select value={route.operator} onChange={e => update(index, { operator: e.target.value })}>
              <option value="contains">Contains</option>
              <option value="equals">Equals</option>
              <option value="not_equals">Does not equal</option>
              <option value="not_empty">Is not empty</option>
              <option value="greater">Greater than</option>
            </select>
          </label>
          {route.operator !== 'not_empty' && (
            <label className="studio-field">
              Compare with
              <input value={route.expected} onChange={e => update(index, { expected: e.target.value })} />
            </label>
          )}
          <label className="studio-field">
            Go to
            <select value={route.target} onChange={e => update(index, { target: e.target.value })}>
              <option value="end">Finish workflow</option>
              {targets.map(target => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onChange({ routes: JSON.stringify(routes.filter((_, i) => i !== index)) })}
          >
            Remove path
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={routes.length >= 8}
        onClick={() =>
          onChange({
            routes: JSON.stringify([
              ...routes,
              {
                label: `Path ${routes.length + 1}`,
                value: '{{message}}',
                operator: 'contains',
                expected: '',
                target: 'end',
              },
            ]),
          })
        }
      >
        Add path
      </button>
      <label className="studio-field">
        If no path matches
        <select value={step.config.fallback || 'end'} onChange={e => onChange({ fallback: e.target.value })}>
          <option value="end">Finish workflow</option>
          {targets.map(target => (
            <option key={target.id} value={target.id}>
              {target.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
