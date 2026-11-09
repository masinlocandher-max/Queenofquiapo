(() => {
  const form = document.getElementById('candidate-form');
  if (!form) return;

  const button = document.getElementById('submit-application');
  const progress = document.getElementById('submit-progress');
  const error = document.getElementById('submit-error');
  const receipt = document.getElementById('receipt');
  const maxFileBytes = 5 * 1024 * 1024;
  const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const previews = new Map();

  function clearPreview(input) {
    const previous = previews.get(input.id);
    if (previous) URL.revokeObjectURL(previous);
    previews.delete(input.id);
    const preview = document.getElementById(input.id + '-preview');
    preview.hidden = true;
    preview.removeAttribute('src');
  }

  function validatePhoto(input) {
    const file = input.files[0];
    let message = '';
    if (file && (file.type ? !acceptedTypes.includes(file.type) : !/\.(jpe?g|png|webp)$/i.test(file.name))) {
      message = 'Choose a JPG, PNG or WebP photo. Export HEIC photos as JPEG first.';
    } else if (file && (file.size === 0 || file.size > maxFileBytes)) {
      message = 'Choose a non-empty photo of 5 MB or less.';
    }
    input.setCustomValidity(message);
    input.setAttribute('aria-invalid', String(Boolean(message)));
    document.getElementById(input.id + '-error').textContent = message;
    return Boolean(file) && !message;
  }

  const photos = Array.from(form.querySelectorAll('input[type=file]'));
  for (const input of photos) {
    input.addEventListener('change', () => {
      clearPreview(input);
      if (!validatePhoto(input)) return;
      const preview = document.getElementById(input.id + '-preview');
      const localUrl = URL.createObjectURL(input.files[0]);
      previews.set(input.id, localUrl);
      preview.src = localUrl;
      preview.hidden = false;
    });
  }

  // Keep this request key across retries without retaining applicant details on the device.
  function requestId() {
    if (self.crypto.randomUUID) return self.crypto.randomUUID();
    const bytes = self.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }
  const submissionToken = requestId();
  form.elements.submissionId.value = submissionToken;
  button.disabled = false;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    photos.forEach(validatePhoto);
    if (!form.reportValidity()) return;

    error.hidden = true;
    error.textContent = '';
    const body = new FormData(form);
    const fields = Array.from(form.querySelectorAll('fieldset'));
    fields.forEach(field => { field.disabled = true; });
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    progress.textContent = 'Uploading both photos and sending your application…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
      const response = await fetch(form.action, {
        method: 'POST', body, credentials: 'same-origin', signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      const result = await response.json().catch(() => null);
      if (![200, 201].includes(response.status) || typeof result?.reference !== 'string' || !result.reference.trim()) {
        let message = 'We could not confirm receipt. Keep this page open and try again.';
        if (typeof result?.error === 'string') message = result.error;
        else if (response.status === 413) message = 'The photos are too large. Choose a smaller copy of each photo and try again.';
        else if (response.status === 429) message = 'Please wait a few minutes, then try again.';
        else if (response.status === 401 || response.status === 403) message = 'Access was interrupted. Keep this page open while you restore access to the site, then try again.';
        throw new Error(message);
      }
      document.getElementById('receipt-reference').textContent = result.reference;
      photos.forEach(clearPreview);
      form.reset();
      form.hidden = true;
      receipt.hidden = false;
      document.getElementById('receipt-title').focus();
      receipt.scrollIntoView({ block: 'start' });
    } catch (failure) {
      error.textContent = failure.name === 'AbortError' || failure instanceof TypeError
        ? 'Your connection was interrupted or the upload took too long. Keep this page open and try again to confirm receipt.'
        : failure.message;
      error.hidden = false;
      error.focus();
    } finally {
      clearTimeout(timeout);
      progress.textContent = '';
      form.removeAttribute('aria-busy');
      fields.forEach(field => { field.disabled = false; });
      button.disabled = false;
    }
  });

  const withdrawOptions = document.getElementById('withdraw-options');
  const withdrawButton = document.getElementById('withdraw-confirm');
  const withdrawCancel = document.getElementById('withdraw-cancel');
  const withdrawError = document.getElementById('withdraw-error');

  withdrawCancel.addEventListener('click', () => {
    withdrawOptions.open = false;
    withdrawError.hidden = true;
    withdrawOptions.querySelector('summary').focus();
  });

  withdrawButton.addEventListener('click', async () => {
    const reference = document.getElementById('receipt-reference').textContent;
    if (withdrawButton.disabled || receipt.hidden || !reference) return;
    withdrawButton.disabled = true;
    withdrawCancel.disabled = true;
    withdrawButton.textContent = 'Withdrawing…';
    withdrawError.hidden = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(form.action + '/' + encodeURIComponent(reference), {
        method: 'DELETE', signal: controller.signal, credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Application-Token': submissionToken }
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) {
        throw new Error(typeof result?.error === 'string' ? result.error : 'We could not confirm withdrawal. Please try again.');
      }
      receipt.hidden = true;
      document.getElementById('withdrawn').hidden = false;
      document.getElementById('withdrawn-title').focus();
    } catch (failure) {
      withdrawError.textContent = failure.name === 'AbortError' || failure instanceof TypeError
        ? 'Your connection was interrupted. Please try again to confirm withdrawal.'
        : failure.message;
      withdrawError.hidden = false;
      withdrawError.focus();
    } finally {
      clearTimeout(timeout);
      withdrawButton.disabled = false;
      withdrawCancel.disabled = false;
      withdrawButton.textContent = 'Confirm withdrawal';
    }
  });
})();
