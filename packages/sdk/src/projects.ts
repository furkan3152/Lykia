/** `@lykia/sdk/projects`: white-label projects (brand, origins, modules, Fence caps, app fee, keys, usage). */
import type { Project, ProjectInput, ProjectPublicView } from "@lykia/core";
import type { CreatedApiKey, ApiKeyView, WebhookEndpointView } from "@lykia/core/api/platform";
import type { LykiaTransport } from "./transport.js";

export interface OriginChallenge {
  readonly origin: string;
  readonly token: string;
  readonly dns: { readonly name: string; readonly type: "TXT"; readonly value: string };
  readonly wellKnown: { readonly url: string; readonly body: string };
}

export interface ProjectUsage {
  readonly projectId: string;
  readonly today: { readonly requests: number; readonly plans: number };
  readonly last7Days: readonly { readonly day: string; readonly requests: number; readonly plans: number }[];
}

export function projectsApi(t: LykiaTransport) {
  const id = (projectId?: string) => {
    const value = projectId ?? t.project;
    if (!value) throw new Error("Pass a project id or create the client with { project }.");
    return encodeURIComponent(value);
  };
  return {
    list: () => t.request<{ projects: Project[] }>("GET", "/v1/projects"),
    create: (input: ProjectInput) => t.request<Project>("POST", "/v1/projects", input),
    get: (projectId?: string) => t.request<Project>("GET", `/v1/projects/${id(projectId)}`),
    update: (patch: Partial<ProjectInput>, projectId?: string) => t.request<Project>("PATCH", `/v1/projects/${id(projectId)}`, patch),
    remove: (projectId?: string) => t.request<{ deleted: true }>("DELETE", `/v1/projects/${id(projectId)}`),
    /** What embeds read: brand, modules, network, disclosed fee. No key needed. */
    public: (projectId?: string) => t.request<ProjectPublicView>("GET", `/v1/projects/${id(projectId)}/public`),
    fence: (projectId?: string) => t.request<{ fence: unknown; fenceHash: string }>("GET", `/v1/projects/${id(projectId)}/fence`),
    challenge: (origin: string, projectId?: string) => t.request<OriginChallenge>("POST", `/v1/projects/${id(projectId)}/origins/challenge`, { origin }),
    verifyOrigin: (origin: string, method: "dns" | "well-known", projectId?: string) => t.request<Project>("POST", `/v1/projects/${id(projectId)}/origins/verify`, { origin, method }),
    keys: (projectId?: string) => t.request<{ keys: ApiKeyView[] }>("GET", `/v1/projects/${id(projectId)}/keys`),
    createKey: (label = "browser", projectId?: string) => t.request<CreatedApiKey>("POST", `/v1/projects/${id(projectId)}/keys`, { label }),
    usage: (projectId?: string) => t.request<ProjectUsage>("GET", `/v1/projects/${id(projectId)}/usage`),
    registerWebhook: (projectId?: string) => t.request<WebhookEndpointView>("POST", `/v1/projects/${id(projectId)}/webhook`, {}),
  };
}

export type ProjectsApi = ReturnType<typeof projectsApi>;
export type { Project, ProjectInput, ProjectPublicView };
