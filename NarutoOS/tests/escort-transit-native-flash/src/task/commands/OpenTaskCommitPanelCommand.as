package task.commands
{
    import fixture.NativeRuntime;
    public final class OpenTaskCommitPanelCommand
    {
        private var id:int;
        public function OpenTaskCommitPanelCommand(id:int) { this.id = id; }
        public function call():void { NativeRuntime.openCommitIds.push(id); }
    }
}
