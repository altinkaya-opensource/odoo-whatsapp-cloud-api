const JSON_RPC_VERSION = "2.0" as const;

type Protocol = "http" | "https";

export interface OdooClientConfig {
  host: string;
  port?: number;
  protocol?: Protocol;
}

export interface OdooAuthenticateParams {
  database: string;
  username: string;
  password: string;
}

export interface OdooLoginResult {
  // Odoo returns `uid: null` after a correct password when TOTP must still
  // be completed on the same partial session.
  uid?: number | null;
  session_id?: string;
  user_context?: Record<string, unknown>;
  [key: string]: unknown;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse<T> {
  jsonrpc: string;
  id?: number | string | null;
  result?: T;
  error?: JsonRpcError;
}

interface RequestOptions {
  context?: Record<string, unknown>;
  offset?: number;
  limit?: number | false;
  order?: string;
  select?: string[];
  lazy?: boolean;
}

interface CallParams {
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

const DEFAULT_PORT = 80;

const getBaseUrl = ({
  host,
  port = DEFAULT_PORT,
  protocol = "http",
}: Required<OdooClientConfig>) => {
  const resolvedProtocol = protocol === "https" ? "https" : "http";
  const hasDefaultPort =
    (resolvedProtocol === "http" && port === 80) ||
    (resolvedProtocol === "https" && port === 443);
  return `${resolvedProtocol}://${host}${hasDefaultPort ? "" : `:${port}`}`;
};

const extractCookies = (response: Response): string[] => {
  const headersWithGetSetCookie = response.headers as Headers & {
    getSetCookie?: () => string[];
    raw?: () => Record<string, string[]>;
  };

  const fromGetSetCookie = headersWithGetSetCookie.getSetCookie?.();
  if (fromGetSetCookie && fromGetSetCookie.length > 0) {
    return fromGetSetCookie;
  }

  const rawHeaders = headersWithGetSetCookie.raw?.();
  if (rawHeaders && Array.isArray(rawHeaders["set-cookie"])) {
    return rawHeaders["set-cookie"];
  }

  const singleCookie = response.headers.get("set-cookie");
  return singleCookie ? [singleCookie] : [];
};

const parseSessionId = (cookies?: string[]) => {
  if (!cookies || cookies.length === 0) {
    return null;
  }
  const sessionCookie = [...cookies]
    .reverse()
    .find((cookie) => cookie.trim().startsWith("session_id="));
  if (!sessionCookie) {
    return null;
  }
  return sessionCookie.split(";")[0].split("=")[1];
};

const parseJsonRpcResponse = <T>(data: JsonRpcResponse<T>): T => {
  if (data.error) {
    const err = new Error(data.error.message);
    (err as Error & { code?: number; data?: unknown }).code = data.error.code;
    (err as Error & { code?: number; data?: unknown }).data = data.error.data;
    throw err;
  }

  if (typeof data.result === "undefined") {
    throw new Error("Unexpected JSON-RPC response: missing result value");
  }

  return data.result;
};

const assertHost = (host?: string): host is string => {
  return typeof host === "string" && host.length > 0;
};

export class OdooClient {
  private readonly config: Required<OdooClientConfig>;
  private readonly baseURL: string;

  constructor(config: OdooClientConfig) {
    if (!assertHost(config.host)) {
      throw new TypeError(`Expected host to be a non-empty string`);
    }

    this.config = {
      host: config.host,
      port: config.port ?? DEFAULT_PORT,
      protocol: config.protocol ?? "http",
    };

    this.baseURL = getBaseUrl(this.config);
  }

  async authenticate(params: OdooAuthenticateParams) {
    const payload = {
      jsonrpc: JSON_RPC_VERSION,
      params: {
        db: params.database,
        login: params.username,
        password: params.password,
      },
    };

    const response = await this.post("/web/session/authenticate", payload);

    if (!response.ok) {
      throw new Error(
        `Unexpected HTTP status from Odoo: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    const cookies = extractCookies(response);
    const sessionId = parseSessionId(cookies);

    if (!sessionId) {
      throw new Error("Unable to determine Odoo session id from response");
    }

    const loginResult = parseJsonRpcResponse<OdooLoginResult>(data);

    const sessionClient = new OdooSessionClient({
      baseURL: this.baseURL,
      sessionId,
      userContext: (loginResult.user_context ?? {}) as Record<string, unknown>,
    });

    return {
      session: sessionClient,
      sessionId,
      cookies: cookies ?? [],
      result: loginResult,
    };
  }

  createSession(sessionId: string, userContext: Record<string, unknown> = {}) {
    return new OdooSessionClient({
      baseURL: this.baseURL,
      sessionId,
      userContext,
    });
  }

  async verifyTotp(sessionId: string, totpToken: string) {
    const response = await fetch(`${this.baseURL}/web/session/totp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: `session_id=${sessionId};`,
      },
      body: JSON.stringify({
        jsonrpc: JSON_RPC_VERSION,
        method: "call",
        params: {
          totp_token: totpToken,
        },
        id: 1,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Unexpected HTTP status from Odoo: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as JsonRpcResponse<OdooLoginResult>;
    const result = parseJsonRpcResponse(data);
    const finalSessionId = parseSessionId(extractCookies(response));
    if (!finalSessionId) {
      throw new Error(
        "Unable to determine finalized Odoo session id from response"
      );
    }
    const session = this.createSession(
      finalSessionId,
      (result.user_context ?? {}) as Record<string, unknown>
    );

    return {
      session,
      sessionId: finalSessionId,
      result,
    };
  }

  private post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.baseURL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  }
}

type SessionClientOptions = {
  baseURL: string;
  sessionId: string;
  userContext: Record<string, unknown>;
};

export class OdooSessionClient {
  private readonly baseURL: string;
  private readonly sessionCookie: string;
  private readonly userContext: Record<string, unknown>;

  constructor(options: SessionClientOptions) {
    this.baseURL = options.baseURL;
    this.sessionCookie = `session_id=${options.sessionId};`;
    // Always include whatsapp_connector context for all frontend calls
    this.userContext = {
      whatsapp_connector: true,
      ...(options.userContext ?? {}),
    };
  }

  async readGroup<T>(
    model: string,
    args: unknown[],
    groupBy: string | string[],
    params: RequestOptions = {}
  ) {
    const groupbyArray = Array.isArray(groupBy) ? groupBy : [groupBy];

    const body = {
      model,
      method: "read_group",
      args: [args],
      kwargs: {
        context: {
          ...this.userContext,
          ...(params.context ?? {}),
        },
        groupby: groupbyArray,
        lazy: params.lazy ?? true,
        offset: params.offset ?? 0,
        limit: params.limit ?? false,
        orderby: params.order ?? false,
        fields: params.select,
      },
    };

    return this.request<T>(body);
  }

  async count(model: string, args: unknown[], params: RequestOptions = {}) {
    const body = {
      model,
      method: "search_count",
      args: [args],
      kwargs: {
        context: {
          ...this.userContext,
          ...(params.context ?? {}),
        },
      },
    };
    return this.request<number>(body);
  }

  async search(model: string, args: unknown[], params: RequestOptions = {}) {
    const body = {
      model,
      method: "search",
      args: [args],
      kwargs: {
        context: {
          ...this.userContext,
          ...(params.context ?? {}),
        },
      },
    };
    return this.request<number[]>(body);
  }

  async read<T>(model: string, args: unknown[], params: RequestOptions = {}) {
    const reqArgs = [args];
    if (params.select) {
      reqArgs.push(params.select);
    }

    const body = {
      model,
      method: "read",
      args: reqArgs,
      kwargs: {
        context: {
          ...this.userContext,
          ...(params.context ?? {}),
        },
      },
    };
    return this.request<T>(body);
  }

  async searchRead<T>(
    model: string,
    args: unknown[],
    params: RequestOptions = {}
  ) {
    const body = {
      model,
      method: "search_read",
      args: [args],
      kwargs: {
        context: {
          ...this.userContext,
          ...(params.context ?? {}),
        },
        offset: params.offset ?? 0,
        limit: params.limit ?? 5,
        order: params.order,
        fields: params.select,
      },
    };
    return this.request<T>(body);
  }

  async create<T>(
    model: string,
    args: Record<string, unknown>,
    params: RequestOptions = {}
  ) {
    const body = {
      model,
      method: "create",
      args: [args],
      kwargs: {
        context: {
          ...this.userContext,
          ...(params.context ?? {}),
        },
      },
    };
    return this.request<T>(body);
  }

  async call<T>(
    model: string,
    method: string,
    args: unknown[],
    params: CallParams = {},
    wrapArgs = true
  ) {
    const resolvedArgs = wrapArgs ? [args] : args;
    const body = {
      model,
      method,
      args: resolvedArgs,
      kwargs: {
        context: this.userContext,
        ...params,
      },
    };
    return this.request<T>(body);
  }

  async callButton<T>(
    model: string,
    method: string,
    args: unknown[],
    wrapArgs = true
  ) {
    const resolvedArgs = wrapArgs ? [args] : args;

    const body = {
      model,
      method,
      args: resolvedArgs,
      context_id: 1,
      domain_id: null,
    };

    return this.request<T>(body, "/web/dataset/call_button");
  }

  /** Call a `type="json"` Odoo controller directly. */
  async callController<T>(path: string, params: Record<string, unknown> = {}) {
    return this.request<T>(params, path);
  }

  private async request<T>(
    params: Record<string, unknown>,
    path = "/web/dataset/call_kw"
  ): Promise<T> {
    const payload = {
      jsonrpc: JSON_RPC_VERSION,
      method: "call",
      params,
    };

    const response = await fetch(`${this.baseURL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Cookie: this.sessionCookie,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Unexpected HTTP status from Odoo: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as JsonRpcResponse<T>;
    return parseJsonRpcResponse(data);
  }
}
