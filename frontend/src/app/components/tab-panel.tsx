import TabPanelSwitcher from "./tab-panel/index";

export default function TabPanel() {
  return (
    <section className="workspace-list relative flex h-full min-h-0 w-full flex-col overflow-hidden">
      <TabPanelSwitcher />
    </section>
  );
}
