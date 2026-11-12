export class CaseReader {
  cases(): unknown[] {
    return [];
  }

  section(): string {
    return '';
  }

  id(): string {
    return '';
  }

  has(): boolean {
    return false;
  }

  input(): string {
    return '';
  }

  compare(): string {
    return '';
  }

  outcome(): string {
    return '';
  }

  fail(): string {
    return '';
  }

  line(): number {
    return 0;
  }

  private declaration(): string {
    return '';
  }

  private matches(): boolean {
    return false;
  }

  private equal(): boolean {
    return false;
  }
}
