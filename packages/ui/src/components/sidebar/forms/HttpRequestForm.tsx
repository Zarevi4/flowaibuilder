interface Props {
  nodeId: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const AUTH_TYPES = ['none', 'bearer', 'basic'] as const;

export function HttpRequestForm({ config, onChange }: Props) {
  const url = (config.url as string) ?? '';
  const method = (config.method as string) ?? 'GET';
  const headers = (config.headers as Record<string, string>) ?? {};
  const body = (config.body as string) ?? '';
  const timeout = (config.timeout as number) ?? 30000;
  const authType = (config.authType as string) ?? 'none';
  const token = (config.token as string) ?? '';
  const username = (config.username as string) ?? '';
  const password = (config.password as string) ?? '';

  const update = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });

  const headerEntries = Object.entries(headers);

  return (
    <div className="space-y-3">
      <Field label="URL">
        <input
          type="text"
          value={url}
          onChange={(e) => update({ url: e.target.value })}
          placeholder="https://api.example.com/data"
          className="input-field"
        />
      </Field>

      <Field label="Method">
        <select value={method} onChange={(e) => update({ method: e.target.value })} className="input-field">
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>

      <Field label="Headers">
        {headerEntries.map(([key, val], i) => (
          <div key={i} className="flex gap-1 mb-1">
            <input
              type="text"
              value={key}
              placeholder="Key"
              className="input-field flex-1"
              onChange={(e) => {
                const newHeaders = { ...headers };
                delete newHeaders[key];
                newHeaders[e.target.value] = val;
                update({ headers: newHeaders });
              }}
            />
            <input
              type="text"
              value={val}
              placeholder="Value"
              className="input-field flex-1"
              onChange={(e) => update({ headers: { ...headers, [key]: e.target.value } })}
            />
            <button
              onClick={() => {
                const newHeaders = { ...headers };
                delete newHeaders[key];
                update({ headers: newHeaders });
              }}
              className="text-gray-500 hover:text-red-400 px-1"
            >
              x
            </button>
          </div>
        ))}
        <button
          onClick={() => update({ headers: { ...headers, '': '' } })}
          className="text-xs text-purple-400 hover:text-purple-300"
        >
          + Add header
        </button>
      </Field>

      {method !== 'GET' && (
        <Field label="Body">
          <textarea
            value={typeof body === 'string' ? body : JSON.stringify(body, null, 2)}
            onChange={(e) => update({ body: e.target.value })}
            rows={4}
            className="input-field font-mono text-xs"
            placeholder='{"key": "value"}'
          />
        </Field>
      )}

      <Field label="Timeout (ms)">
        <input
          type="number"
          value={timeout}
          onChange={(e) => update({ timeout: Number(e.target.value) })}
          className="input-field"
        />
      </Field>

      <Field label="Auth Type">
        <select value={authType} onChange={(e) => update({ authType: e.target.value })} className="input-field">
          {AUTH_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </Field>

      {authType === 'bearer' && (
        <Field label="Token">
          <input
            type="password"
            value={token}
            onChange={(e) => update({ token: e.target.value })}
            className="input-field"
          />
        </Field>
      )}

      {authType === 'basic' && (
        <>
          <Field label="Username">
            <input type="text" value={username} onChange={(e) => update({ username: e.target.value })} className="input-field" />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={(e) => update({ password: e.target.value })} className="input-field" />
          </Field>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-400 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
