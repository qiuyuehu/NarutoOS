"""Compatibility entry point; all activity patches are now built together."""
from pathlib import Path
import runpy

if __name__ == '__main__':
    print('达摩辅助已纳入统一活动插件，转交 prepare-activity-assist.py')
    runpy.run_path(str(Path(__file__).with_name('prepare-activity-assist.py')), run_name='__main__')
