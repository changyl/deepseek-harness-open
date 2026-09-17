// @vitest-environment jsdom
/**
 * The project section's rendering rules: the loading, failed, and ready reads;
 * the project rows and their counts; opening one board and its status lanes;
 * the ready/stranded notices; the truncated-listing notice; and the refresh
 * gesture.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  ProjectBoardWire,
  ProjectListWire,
  ProjectSummaryWire,
  ProjectTaskWire,
  ProjectViewWire,
  TaskStatus,
} from '@deepseek-ai/dsh-api-project/types'
import { ProjectSection } from '../src/client/ProjectSection.tsx'
import type { ProjectSectionProps } from '../src/client/ProjectSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function task(id: string, over: Partial<ProjectTaskWire> = {}): ProjectTaskWire {
  return {
    id,
    title: `task ${id}`,
    status: 'todo',
    blockedBy: [],
    sessionIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function lanes(over: Partial<Record<TaskStatus, readonly ProjectTaskWire[]>> = {}): ProjectBoardWire['columns'] {
  return {
    todo: [],
    doing: [],
    blocked: [],
    done: [],
    cancelled: [],
    ...over,
  }
}

function summary(id: string, title: string, over: Partial<ProjectSummaryWire> = {}): ProjectSummaryWire {
  return {
    id,
    title,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    revision: 0,
    tasks: 0,
    ready: 0,
    stranded: 0,
    ...over,
  }
}

function listing(over: Partial<ProjectListWire> = {}): ProjectListWire {
  return { projects: [summary('project-1', 'Release'), summary('project-2', 'Chores', { status: 'closed' })], truncated: false, ...over }
}

function projectView(over: Partial<ProjectViewWire> = {}): ProjectViewWire {
  return {
    id: 'project-1',
    title: 'Release',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    revision: 3,
    tasks: [],
    ...over,
  }
}

function board(over: Partial<ProjectBoardWire> = {}): ProjectBoardWire {
  return {
    project: projectView(),
    columns: lanes(),
    ready: [],
    stranded: [],
    ...over,
  }
}

/**
 * Render the section over scripted Remote calls.
 * @param list - the listing read.
 * @param board - the board read.
 */
function renderSection(
  list: ProjectSectionProps['list'],
  readBoard: ProjectSectionProps['board'] = () => Promise.resolve(board()),
) {
  const props = {
    close: vi.fn(),
    t: makeTranslate(en),
    list,
    board: readBoard,
  } as unknown as ProjectSectionProps
  render(<ProjectSection {...props} />)
}

describe('the project section', () => {
  it('reports the listing read, then the rows a reader opens', async () => {
    const list = vi.fn(() => Promise.resolve(listing()))
    renderSection(list)
    expect(screen.getByRole('status').textContent).toBe(en.loading)

    expect(await screen.findByRole('heading', { name: en.title })).toBeDefined()
    expect(list).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Release' })).toBeDefined()
    expect(screen.getByText(en['projectStatus.active'])).toBeDefined()
    expect(screen.getByText(en['projectStatus.closed'])).toBeDefined()
    expect(screen.getByText(en['board.hint'])).toBeDefined()
  })

  it('reads one board and renders its lanes, ready set, and stranded set', async () => {
    const loaded = board({
      project: projectView({ tasks: [task('task-1', { status: 'done' }), task('task-2', { status: 'doing', blockedBy: ['task-1'], sessionIds: ['session-1'] })] }),
      columns: lanes({
        done: [task('task-1', { status: 'done' })],
        doing: [task('task-2', { status: 'doing', blockedBy: ['task-1'], sessionIds: ['session-1'] })],
      }),
      ready: ['task-3'],
      stranded: ['task-2'],
    })
    const read = vi.fn(() => Promise.resolve(loaded))
    renderSection(
      () => Promise.resolve(listing({ projects: [summary('project-1', 'Release', { tasks: 2, ready: 1, stranded: 1 })] })),
      read,
    )

    await screen.findByRole('heading', { name: en.title })
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))

    expect(await screen.findByText(en['board.ready'].replace('{titles}', 'task-3'))).toBeDefined()
    expect(read).toHaveBeenCalledWith('project-1')
    const doing = screen.getByRole('heading', { name: en['status.doing'] }).nextElementSibling as HTMLElement
    const row = within(doing).getByText('task task-2')
    expect(row).toBeDefined()
    const meta = row.parentElement as HTMLElement
    expect(within(meta).getByText(en['board.blockedBy'].replace('{count}', '1'))).toBeDefined()
    expect(within(meta).getByText(en['board.sessions'].replace('{count}', '1'))).toBeDefined()
    expect(screen.getByText(en['board.stranded'].replace('{titles}', 'task-2'))).toBeDefined()
    expect(screen.queryByText(en['board.empty'])).toBeNull()
  })

  it('states an empty host, a truncated listing, and an empty board', async () => {
    renderSection(
      () => Promise.resolve(listing({ projects: [], truncated: true })),
      () => Promise.resolve(board()),
    )

    expect(await screen.findByText(en['projects.empty'])).toBeDefined()
    expect(screen.getByText(en['projects.truncated'])).toBeDefined()
  })

  it('states a project whose board holds no task', async () => {
    renderSection(() => Promise.resolve(listing({ projects: [summary('project-1', 'Release')] })))

    await screen.findByRole('heading', { name: en.title })
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(await screen.findByText(en['board.empty'])).toBeDefined()
    expect(screen.queryByRole('heading', { name: en['status.todo'] })).toBeNull()
  })

  it('offers a retry after a failed listing read', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('project/unavailable'))
      .mockResolvedValueOnce(listing({ projects: [summary('project-1', 'Release')] }))
    renderSection(list)

    expect((await screen.findByRole('alert')).textContent).toBe(en.failed)
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(await screen.findByRole('button', { name: 'Release' })).toBeDefined()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('reports a board read that fails and holds the refresh control while the next read is in flight', async () => {
    let settle = (value: ProjectListWire): void => { void value }
    const second = new Promise<ProjectListWire>((resolve) => { settle = resolve })
    const read = vi.fn(() => Promise.reject(new Error('project/not-found')))
    const list = vi.fn()
      .mockResolvedValueOnce(listing({ projects: [summary('project-1', 'Release')] }))
      .mockImplementationOnce(() => second)
    renderSection(list, read)

    await screen.findByRole('heading', { name: en.title })
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect((await screen.findByRole('alert')).textContent).toBe(en['board.failed'])

    const refresh = screen.getByRole('button', { name: en.refresh })
    fireEvent.click(refresh)
    expect((refresh as HTMLButtonElement).disabled).toBe(true)
    expect(await screen.findByText(en['board.hint'])).toBeDefined()

    settle(listing({ projects: [] }))
    await waitFor(() => { expect(screen.getByText(en['projects.empty'])).toBeDefined() })
    expect((refresh as HTMLButtonElement).disabled).toBe(false)
  })
})
