import { AddClientForm } from './AddClientForm'
import { useClients } from './useClients'

// The add form, on the Clients tab, so the commonest management action sits
// where the hand reaches for it -- owner, 2026-09-02. The full roster stays in
// Admin; this is the one action lifted out of it.
//
// A component rather than a branch inside Board, and that is not a style
// choice: useClients fetches on mount and a hook cannot be called
// conditionally, so putting it in Board would make every visit to the Clients
// tab pay for a form nobody opened. Mounted on demand, it costs nothing until
// somebody presses the button.
//
// It reuses AddClientForm rather than reimplementing it, so the two entry points
// cannot disagree about what adding a client means -- including the validation
// and the confirmation behaviour that form already gets right.
export function AddClientPanel({ onClose }: { onClose: () => void }) {
  const admin = useClients()
  return (
    <section>
      <AddClientForm
        onAdd={admin.addClient}
        onEdited={admin.resetAdd}
        owners={admin.owners}
        state={admin.addState}
      />
      {/* "Done" rather than "Cancel": the form may have added several clients by
          now, and calling the way out "Cancel" would suggest closing undoes
          them. Closing is also what re-reads the board -- see Board.tsx. */}
      <button className="button button--quiet" onClick={onClose} type="button">
        Done
      </button>
    </section>
  )
}
