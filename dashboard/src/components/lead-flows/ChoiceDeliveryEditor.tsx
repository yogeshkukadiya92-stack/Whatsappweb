import type { LeadFlowChoiceDelivery, LeadFlowStep } from '../../services/api';

export function ChoiceDeliveryEditor({
  step,
  onChange,
  onNativeChange,
}: {
  step: LeadFlowStep;
  onChange: (deliveries: LeadFlowChoiceDelivery[]) => void;
  onNativeChange: (enabled: boolean) => void;
}) {
  if (!step.options?.length) return null;
  const update = (option: string, patch: Partial<LeadFlowChoiceDelivery> | null) => {
    const others = (step.deliveries || []).filter(item => item.option !== option);
    const current = step.deliveries?.find(item => item.option === option);
    onChange(patch ? [...others, { option, type: 'link', url: '', ...current, ...patch }] : others);
  };
  return (
    <fieldset className="choice-delivery-editor">
      <legend>Send a resource when selected</legend>
      <p className="form-hint">
        Each choice can send its own PDF, video or link and finish the flow. WhatsApp Web sessions show choices as a
        single-choice poll. Customers select an option and tap Vote.
      </p>
      <label>
        <input
          type="checkbox"
          checked={step.nativeButtons === true}
          onChange={event => onNativeChange(event.target.checked)}
        />{' '}
        Also use native Business API buttons
      </label>
      {step.nativeButtons && (
        <p className="form-hint">
          Requires the Business API connection above. Use this as the first question of the flow, with 2–3 choices,
          titles up to 20 characters, and a resource for each choice. QR sessions still send a poll.
        </p>
      )}
      {(step.options || [])
        .filter(option => option.trim())
        .map((option, index) => {
          const delivery = step.deliveries?.find(item => item.option === option);
          return (
            <div className="form-group" key={index}>
              <label>{option}</label>
              <select
                aria-label={`Delivery for ${option}`}
                value={delivery?.type || ''}
                onChange={event =>
                  update(
                    option,
                    event.target.value ? { type: event.target.value as LeadFlowChoiceDelivery['type'] } : null,
                  )
                }
              >
                <option value="">Continue to next question</option>
                <option value="document">Send PDF / document</option>
                <option value="video">Send video</option>
                <option value="link">Send link</option>
              </select>
              {delivery && (
                <>
                  <input
                    aria-label={`Resource URL for ${option}`}
                    type="url"
                    placeholder="https://example.com/resource.pdf"
                    value={delivery.url}
                    onChange={event => update(option, { url: event.target.value })}
                    required
                  />
                  <input
                    aria-label={`Message for ${option}`}
                    placeholder="Message or caption (optional)"
                    value={delivery.caption || ''}
                    onChange={event => update(option, { caption: event.target.value })}
                  />
                  {delivery.type === 'document' && (
                    <input
                      aria-label={`Filename for ${option}`}
                      placeholder="brochure.pdf (optional)"
                      value={delivery.filename || ''}
                      onChange={event => update(option, { filename: event.target.value })}
                    />
                  )}
                  <small className="form-hint">
                    Use a publicly accessible URL. Only this choice's resource will be sent.
                  </small>
                </>
              )}
            </div>
          );
        })}
    </fieldset>
  );
}
