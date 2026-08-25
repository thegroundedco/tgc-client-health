import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { CONCURRENT_SAVE_TEXT } from '../clients/clientForm'
import {
  INVITATION_COLUMNS,
  PROFILE_COLUMNS,
  UPDATE_MATCHED_NOTHING_TEXT,
  invitePayload,
  sortInvitations,
  sortProfiles,
  writeFailureText,
} from './userForm'
import type { AdminProfile, InviteDraft, Invitation, WriteState } from './userForm'

export type UseUsers = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  profiles: AdminProfile[]
  invitations: Invitation[]
  inviteState: WriteState
  editState: WriteState
  // Which profile editState is ABOUT. Same reason as useClients' editStateFor:
  // one state per screen, controls per row, so without the id a confirmation for
  // one person renders beside another.
  editStateFor: string | null
  reload: () => void
  invite: (draft: InviteDraft) => void
  revokeInvite: (email: string) => void
  setRole: (id: string, role: string) => void
  setActive: (id: string, isActive: boolean) => void
  resetInvite: () => void
  resetEdit: () => void
}

export function useUsers(): UseUsers {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<AdminProfile[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [inviteState, setInviteState] = useState<WriteState>({ kind: 'idle' })
  const [editState, setEditState] = useState<WriteState>({ kind: 'idle' })
  const [editStateFor, setEditStateFor] = useState<string | null>(null)

  const inviteInFlight = useRef(false)
  const editInFlight = useRef(false)

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setStatus('loading')
    try {
      const profileResult = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .order('email')

      if (isCancelled()) return
      if (profileResult.error) {
        setLoadError(describeError(profileResult.error))
        setStatus('error')
        return
      }

      // Readable only by manage_users. A non-admin reaching this screen gets an
      // empty list rather than an error, because RLS filters rows instead of
      // raising -- which is why the screen is drawn behind can() at all.
      const inviteResult = await supabase
        .from('allowed_emails')
        .select(INVITATION_COLUMNS)
        .order('created_at')

      if (isCancelled()) return
      if (inviteResult.error) {
        setLoadError(describeError(inviteResult.error))
        setStatus('error')
        return
      }

      setLoadError(null)
      setProfiles(sortProfiles(profileResult.data))
      setInvitations(sortInvitations(inviteResult.data))
      setStatus('ready')
    } catch (thrown) {
      if (isCancelled()) return
      setLoadError(describeError(thrown))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void load(() => cancelled)
    return () => { cancelled = true }
  }, [load])

  const invite = useCallback((draft: InviteDraft) => {
    if (inviteInFlight.current) {
      setInviteState({ kind: 'failed', message: CONCURRENT_SAVE_TEXT })
      return
    }
    inviteInFlight.current = true
    setInviteState({ kind: 'saving' })

    void (async () => {
      const payload = invitePayload(draft)
      try {
        const { data, error } = await supabase
          .from('allowed_emails')
          .insert(payload)
          .select(INVITATION_COLUMNS)
          .single()

        if (error) {
          setInviteState({ kind: 'failed', message: writeFailureText(describeError(error), payload.email) })
          return
        }

        setInvitations((current) => sortInvitations([...current, data]))
        setInviteState({ kind: 'saved', at: data.created_at, what: `${payload.email} invited` })
      } catch (thrown) {
        setInviteState({ kind: 'failed', message: writeFailureText(describeError(thrown), payload.email) })
      } finally {
        inviteInFlight.current = false
      }
    })()
  }, [])

  const revokeInvite = useCallback((email: string) => {
    if (inviteInFlight.current) {
      setInviteState({ kind: 'failed', message: CONCURRENT_SAVE_TEXT })
      return
    }
    inviteInFlight.current = true
    setInviteState({ kind: 'saving' })

    void (async () => {
      try {
        const { error } = await supabase.from('allowed_emails').delete().eq('email', email)
        if (error) {
          setInviteState({ kind: 'failed', message: writeFailureText(describeError(error), email) })
          return
        }
        setInvitations((current) => current.filter((row) => row.email !== email))
        setInviteState({ kind: 'saved', at: new Date().toISOString(), what: `Invitation for ${email} revoked` })
      } catch (thrown) {
        setInviteState({ kind: 'failed', message: writeFailureText(describeError(thrown), email) })
      } finally {
        inviteInFlight.current = false
      }
    })()
  }, [])

  // One writer for both privileged columns, because both go through the same
  // policy, the same grant and the same guard trigger, and every failure branch
  // reads identically. Two near-identical copies would be two places to get the
  // PGRST116 handling wrong.
  const writeProfile = useCallback(
    (id: string, patch: { role: string } | { is_active: boolean }, what: string) => {
      const report = (next: WriteState) => {
        setEditStateFor(id)
        setEditState(next)
      }

      if (editInFlight.current) {
        report({ kind: 'failed', message: CONCURRENT_SAVE_TEXT })
        return
      }
      editInFlight.current = true
      report({ kind: 'saving' })

      void (async () => {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .update(patch)
            .eq('id', id)
            .select(PROFILE_COLUMNS)
            // .maybeSingle(), not .single(). Two distinct failure shapes reach
            // here and only one is an error: the guard trigger RAISES 42501 with
            // a message, while a caller without manage_users has the row filtered
            // out by USING and gets zero rows and no error at all. .single()
            // would turn the second into PGRST116, which no branch translates.
            .maybeSingle()

          if (error) {
            report({ kind: 'failed', message: writeFailureText(describeError(error), id) })
            return
          }

          if (data === null) {
            report({ kind: 'failed', message: UPDATE_MATCHED_NOTHING_TEXT })
            return
          }

          setProfiles((current) => sortProfiles(current.map((row) => (row.id === id ? data : row))))
          report({ kind: 'saved', at: data.updated_at, what })
        } catch (thrown) {
          report({ kind: 'failed', message: writeFailureText(describeError(thrown), id) })
        } finally {
          editInFlight.current = false
        }
      })()
    },
    [],
  )

  const setRole = useCallback(
    (id: string, role: string) => writeProfile(id, { role }, 'Role changed'),
    [writeProfile],
  )

  const setActive = useCallback(
    (id: string, isActive: boolean) =>
      writeProfile(id, { is_active: isActive }, isActive ? 'Account activated' : 'Account deactivated'),
    [writeProfile],
  )

  return {
    status, loadError, profiles, invitations,
    inviteState, editState, editStateFor,
    reload: () => void load(),
    invite, revokeInvite, setRole, setActive,
    resetInvite: () => setInviteState({ kind: 'idle' }),
    resetEdit: () => setEditState({ kind: 'idle' }),
  }
}
