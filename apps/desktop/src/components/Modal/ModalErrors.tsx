import surface from "./surface.module.css";

/** What went wrong, between a dialog's body and its buttons — so it is in view the moment it
 *  appears. Draws nothing when there is nothing to say. */
function ModalErrors({ messages }: { messages: readonly string[] }) {
  const shown = messages.filter((message) => message !== "");
  if (shown.length === 0) return null;
  return (
    <div className={surface.errors} role="alert">
      {shown.map((message, i) => (
        <p key={i}>{message}</p>
      ))}
    </div>
  );
}

export default ModalErrors;
