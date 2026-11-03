import { createContext, useContext } from 'react'
import type { WorkspaceApi } from './workspaceTypes'

export const WorkspaceContext = createContext<WorkspaceApi | null>(null)

export function useWorkspace(): WorkspaceApi {
  const api = useContext(WorkspaceContext)
  if (api === null) {
    throw new Error('useWorkspace must be used inside WorkspaceProvider')
  }
  return api
}
