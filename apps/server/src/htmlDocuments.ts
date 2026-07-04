import type { ProjectId, ThreadId } from "@t3tools/contracts";

export const HTML_DOCUMENTS_ROUTE_PREFIX = "/documents";
export const HTML_DOCUMENT_PROJECTS_SEGMENT = "projects";
export const HTML_DOCUMENT_THREADS_SEGMENT = "threads";
export const HTML_DOCUMENT_PROJECT_ID_TEMPLATE = "{projectId}";
export const HTML_DOCUMENT_THREAD_ID_TEMPLATE = "{threadId}";

export interface HtmlDocumentProjectScope {
  readonly directory: string;
  readonly url: string;
  readonly tailscaleUrl?: string;
}

export interface HtmlDocumentThreadScope {
  readonly directory: string;
  readonly url: string;
  readonly tailscaleUrl?: string;
}

export interface HtmlDocumentPublishingInfo {
  readonly rootDirectory: string;
  readonly rootUrl: string;
  readonly projectDirectoryTemplate: string;
  readonly projectUrlTemplate: string;
  readonly threadDirectoryTemplate: string;
  readonly threadUrlTemplate: string;
  readonly tailscaleRootUrl?: string;
  readonly tailscaleProjectUrlTemplate?: string;
  readonly tailscaleThreadUrlTemplate?: string;
}

export function encodeHtmlDocumentScopeSegment(value: string): string {
  return encodeURIComponent(value);
}

const appendTrailingSlash = (value: string): string => (value.endsWith("/") ? value : `${value}/`);

function joinDocumentDirectory(rootDirectory: string, ...segments: readonly string[]): string {
  const separator = rootDirectory.includes("\\") && !rootDirectory.includes("/") ? "\\" : "/";
  const normalizedRoot = rootDirectory.replace(/[\\/]+$/u, "");
  return [normalizedRoot, ...segments].join(separator);
}

function htmlDocumentsUrl(pathname: string, baseUrl: string): string {
  return new URL(pathname, baseUrl).toString();
}

function htmlDocumentsTemplateUrl(pathnameTemplate: string, baseUrl: string): string {
  return `${new URL("/", baseUrl).origin}${pathnameTemplate}`;
}

export function htmlDocumentsRootUrl(baseUrl: string): string {
  return htmlDocumentsUrl(`${HTML_DOCUMENTS_ROUTE_PREFIX}/`, baseUrl);
}

export function htmlDocumentProjectPathname(projectId: ProjectId | string): string {
  return `${HTML_DOCUMENTS_ROUTE_PREFIX}/${HTML_DOCUMENT_PROJECTS_SEGMENT}/${encodeHtmlDocumentScopeSegment(projectId)}/`;
}

export function htmlDocumentThreadPathname(input: {
  readonly projectId: ProjectId | string;
  readonly threadId: ThreadId | string;
}): string {
  return `${htmlDocumentProjectPathname(input.projectId)}${HTML_DOCUMENT_THREADS_SEGMENT}/${encodeHtmlDocumentScopeSegment(input.threadId)}/`;
}

export function htmlDocumentProjectDirectory(input: {
  readonly rootDirectory: string;
  readonly projectId: ProjectId | string;
}): string {
  return joinDocumentDirectory(
    input.rootDirectory,
    HTML_DOCUMENT_PROJECTS_SEGMENT,
    encodeHtmlDocumentScopeSegment(input.projectId),
  );
}

export function htmlDocumentThreadDirectory(input: {
  readonly rootDirectory: string;
  readonly projectId: ProjectId | string;
  readonly threadId: ThreadId | string;
}): string {
  return joinDocumentDirectory(
    htmlDocumentProjectDirectory({
      rootDirectory: input.rootDirectory,
      projectId: input.projectId,
    }),
    HTML_DOCUMENT_THREADS_SEGMENT,
    encodeHtmlDocumentScopeSegment(input.threadId),
  );
}

export function resolveHtmlDocumentProjectScope(input: {
  readonly rootDirectory: string;
  readonly baseUrl: string;
  readonly projectId: ProjectId | string;
  readonly tailscaleBaseUrl?: string | null;
}): HtmlDocumentProjectScope {
  const pathname = htmlDocumentProjectPathname(input.projectId);
  return {
    directory: htmlDocumentProjectDirectory({
      rootDirectory: input.rootDirectory,
      projectId: input.projectId,
    }),
    url: htmlDocumentsUrl(pathname, input.baseUrl),
    ...(input.tailscaleBaseUrl
      ? { tailscaleUrl: htmlDocumentsUrl(pathname, input.tailscaleBaseUrl) }
      : {}),
  };
}

export function resolveHtmlDocumentThreadScope(input: {
  readonly rootDirectory: string;
  readonly baseUrl: string;
  readonly projectId: ProjectId | string;
  readonly threadId: ThreadId | string;
  readonly tailscaleBaseUrl?: string | null;
}): HtmlDocumentThreadScope {
  const pathname = htmlDocumentThreadPathname({
    projectId: input.projectId,
    threadId: input.threadId,
  });
  return {
    directory: htmlDocumentThreadDirectory({
      rootDirectory: input.rootDirectory,
      projectId: input.projectId,
      threadId: input.threadId,
    }),
    url: htmlDocumentsUrl(pathname, input.baseUrl),
    ...(input.tailscaleBaseUrl
      ? { tailscaleUrl: htmlDocumentsUrl(pathname, input.tailscaleBaseUrl) }
      : {}),
  };
}

export function makeHtmlDocumentPublishingInfo(input: {
  readonly rootDirectory: string;
  readonly baseUrl: string;
  readonly tailscaleBaseUrl?: string | null;
}): HtmlDocumentPublishingInfo {
  const projectPathnameTemplate = `${HTML_DOCUMENTS_ROUTE_PREFIX}/${HTML_DOCUMENT_PROJECTS_SEGMENT}/${HTML_DOCUMENT_PROJECT_ID_TEMPLATE}/`;
  const threadPathnameTemplate = `${projectPathnameTemplate}${HTML_DOCUMENT_THREADS_SEGMENT}/${HTML_DOCUMENT_THREAD_ID_TEMPLATE}/`;
  const projectDirectoryTemplate = joinDocumentDirectory(
    input.rootDirectory,
    HTML_DOCUMENT_PROJECTS_SEGMENT,
    HTML_DOCUMENT_PROJECT_ID_TEMPLATE,
  );
  const threadDirectoryTemplate = joinDocumentDirectory(
    projectDirectoryTemplate,
    HTML_DOCUMENT_THREADS_SEGMENT,
    HTML_DOCUMENT_THREAD_ID_TEMPLATE,
  );
  const tailscaleBaseUrl = input.tailscaleBaseUrl
    ? appendTrailingSlash(new URL("/", input.tailscaleBaseUrl).origin)
    : undefined;

  return {
    rootDirectory: input.rootDirectory,
    rootUrl: htmlDocumentsRootUrl(input.baseUrl),
    projectDirectoryTemplate,
    projectUrlTemplate: htmlDocumentsTemplateUrl(projectPathnameTemplate, input.baseUrl),
    threadDirectoryTemplate,
    threadUrlTemplate: htmlDocumentsTemplateUrl(threadPathnameTemplate, input.baseUrl),
    ...(tailscaleBaseUrl
      ? {
          tailscaleRootUrl: htmlDocumentsRootUrl(tailscaleBaseUrl),
          tailscaleProjectUrlTemplate: htmlDocumentsTemplateUrl(
            projectPathnameTemplate,
            tailscaleBaseUrl,
          ),
          tailscaleThreadUrlTemplate: htmlDocumentsTemplateUrl(
            threadPathnameTemplate,
            tailscaleBaseUrl,
          ),
        }
      : {}),
  };
}
