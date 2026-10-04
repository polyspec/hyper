// The entry of a page loads the form code only on a page that has a form (HY-76).
if (document.querySelector('form') !== null) {
  const { bindForms } = await import('./forms.ts');
  bindForms();
}
