import py_compile
try:
    py_compile.compile('orchestrator.py', doraise=True)
    print("ALL OK")
except Exception as e:
    print(e)
