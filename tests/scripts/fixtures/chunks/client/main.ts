// The entry of a page loads the form code only on a page that has a form (HY-76), and reads the template index
// of its build (HY-34).
import index from '@polyspec/hyper/templates-index';

console.log(index['home.tpl']?.url);
if (document.querySelector('form') !== null) {
  const { bindForms } = await import('./forms.ts');
  bindForms();
}
