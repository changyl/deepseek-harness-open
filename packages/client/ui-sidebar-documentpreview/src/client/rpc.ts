/**
 * The reads and the one write this type performs, bound to the Client Remote.
 *
 * Content is the consumer's business: the `file` resource carries metadata only,
 * and the text arrives here one page of lines at a time. The endpoint takes a
 * session and a workspace path while a tab carries a `dsh-resource://file/`
 * session address, so this module also owns that translation.
 *
 * Editing reads the file a second way. A page is a lossy view — its text is
 * lines joined back together, so a file that ends in a newline and one that does
 * not arrive identical — and seeding an editor from it would silently drop that
 * newline on the next save. The editor's draft therefore comes from the whole
 * file instead, and the two reads are kept as separate bindings so neither can
 * be mistaken for the other.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  WorkspaceFileBytes,
  WorkspaceFileRange,
  WorkspaceFileText,
  WorkspaceFileWriteRequest,
  WorkspaceFileWriteResult,
} from '@deepseek-ai/dsh-api-workspace-files/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

/** The read slice of the Client Remote this package calls. */
export interface WorkspaceFilesReadRemote {
  readonly workspaceFiles: {
    /**
     * Read one page of lines.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param range - 1-based start line; the Host's page cap applies when `limit` is absent.
     * @param signal - cancels the call.
     * @returns the page, or the failure the Host declares.
     */
    read(
      sessionId: SessionId,
      path: string,
      range: WorkspaceFileRange,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileText>>
  }
}

/** The whole-file read and the write the editor needs from the Client Remote. */
export interface WorkspaceFilesEditRemote {
  readonly workspaceFiles: {
    /**
     * Read one file complete, for a draft that can be saved back unchanged.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param signal - cancels the call.
     * @returns the whole file, or the failure the Host declares.
     */
    readAll(
      sessionId: SessionId,
      path: string,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileBytes>>
    /**
     * Replace one file's contents.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param request - the new contents and, when guarded, the version they came from.
     * @param signal - cancels the call.
     * @returns the new version and the prior content, or the refusal the Host declares.
     */
    write(
      sessionId: SessionId,
      path: string,
      request: WorkspaceFileWriteRequest,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileWriteResult>>
  }
}

/**
 * The read one page performs, injected so the face stays host-free.
 *
 * The session travels with the call because the endpoint resolves the workspace
 * root from it: the same path means different files in different sessions. A
 * Remote call does not reject: the result carries the failure.
 */
export type ReadWorkspaceFilePage = (
  sessionId: SessionId,
  path: string,
  offset: number,
  signal: AbortSignal,
) => Promise<RemoteResult<WorkspaceFileText>>

/** The file one tab reads: the session the read runs under and the path handed to the Host. */
export interface SessionFile {
  /** The Session whose workspace resolves relative paths. */
  readonly sessionId: SessionId
  /** The path the Host receives, absolute or relative to the addressed Session's workspace. */
  readonly path: string
}

/**
 * The session and path one `dsh-resource://file/…` address names.
 *
 * A `session` address names its own session and a relative or absolute path, so
 * a tab addressed into another session reads from that session. An `absolute`
 * address carries no session and cannot be read here. The registry routes only
 * session-scoped `file` addresses to this type, so an address `parseFileAddress`
 * rejects or that carries no session is a programming error and throws.
 * @param address - a tab's `dsh-resource://file/…` address.
 * @returns the session and the path to hand the endpoint.
 */
export function hostFileOf(address: string): SessionFile {
  const parsed = parseFileAddress(address)
  if (parsed?.scope !== 'session') throw new Error(`ui-sidebar-documentpreview: not a session file address "${address}"`)
  // The address is a string boundary: its id segment is the Session id it names.
  return { sessionId: parsed.sessionId as SessionId, path: parsed.path }
}

/**
 * Bind the paged read to one Remote face. The page length is the Host's
 * configured cap, so no `limit` travels.
 * @param remote - the Client Remote carrying the `workspaceFiles` namespace.
 * @returns the read the face performs.
 */
export function createReadPage(remote: WorkspaceFilesReadRemote): ReadWorkspaceFilePage {
  return (sessionId, path, offset, signal) => remote.workspaceFiles.read(sessionId, path, { offset }, signal)
}

/** Complete document bytes borrowed read-only by renderers; copy before transferring to a Worker. */
export type DocumentFileBytes = Omit<WorkspaceFileBytes, 'data'> & { readonly data: Uint8Array<ArrayBuffer> }

/**
 * Read a complete file through the Host endpoint.
 * @param file - Session and path decoded from the tab address.
 * @param signal - owning tab lifetime.
 * @returns complete binary bytes, including declared failures.
 */
export type ReadDocumentBytes = (file: SessionFile, signal: AbortSignal) => Promise<RemoteResult<DocumentFileBytes>>

/**
 * Decode one successful Remote byte result for document renderers.
 * @param file - Host byte result with base64 data.
 * @returns the same metadata with native bytes; malformed base64 throws.
 */
export function documentFileBytes(file: WorkspaceFileBytes): DocumentFileBytes {
  const binary = atob(file.data)
  const data = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) data[index] = binary.charCodeAt(index)
  return { ...file, data }
}

/**
 * Decode already-decoded document bytes into editor text.
 *
 * `ignoreBOM` keeps a leading byte-order mark in the text instead of letting
 * `TextDecoder` swallow it, so a file that carries one round-trips through a
 * save. Decoding never throws — malformed bytes become U+FFFD — which is why
 * editing is offered only for a file the paged read already accepted as text.
 * @param file - decoded document bytes.
 * @returns the file as text, byte-order mark included.
 */
export function decodeDocumentText(file: DocumentFileBytes): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(file.data)
}

/**
 * Decode one whole-file result into editor text.
 * @param file - Host byte result with base64 data.
 * @returns the file as text, byte-order mark included.
 */
export function documentFileText(file: WorkspaceFileBytes): string {
  return decodeDocumentText(documentFileBytes(file))
}

/** Replace one file's contents through the Host endpoint. */
export type WriteWorkspaceFile = (
  file: SessionFile,
  text: string,
  expectedVersion: string | undefined,
  signal: AbortSignal,
) => Promise<RemoteResult<WorkspaceFileWriteResult>>

/**
 * Bind the guarded whole-file write to one Remote face.
 * @param remote - the Client Remote carrying the `workspaceFiles` namespace.
 * @returns the write the face performs.
 */
export function createWriteFile(remote: WorkspaceFilesEditRemote): WriteWorkspaceFile {
  return (file, text, expectedVersion, signal) => remote.workspaceFiles.write(
    file.sessionId,
    file.path,
    // Omitting the guard is the forced overwrite the conflict prompt offers.
    expectedVersion === undefined ? { text } : { text, expectedVersion },
    signal,
  )
}
