export function resolveInferenceAdapter({ provider, url }) {
  const normalizedProvider = String(provider ?? '').trim().toLowerCase();
  if (normalizedProvider) return normalizedProvider;
  return isLocalInferenceUrl(url) ? 'local' : 'huggingface';
}

export function isLocalInferenceUrl(url) {
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function buildInferenceHeaders({ adapter, token, contentType, waitForModel = false, model }) {
  const headers = { 'Content-Type': contentType };

  if (model) headers['X-SAFi-Model'] = model;
  if (adapter !== 'local' && waitForModel) headers['X-Wait-For-Model'] = 'true';
  if (adapter !== 'local' && token) headers.Authorization = `Bearer ${token}`;

  return headers;
}

export function assertTokenIfNeeded({ adapter, token, label }) {
  if (adapter !== 'local' && !token) {
    throw new Error(`HF_TOKEN or ${label}_API_KEY is required for hosted ${label.toLowerCase()} inference`);
  }
}
