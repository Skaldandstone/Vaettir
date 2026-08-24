import TestCaseForm from "../../../components/TestCaseForm";

export default function NewTestCasePage() {
  return (
    <div>
      <h1>New test case</h1>
      <TestCaseForm mode="create" />
    </div>
  );
}
