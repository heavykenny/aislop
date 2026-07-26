using System.Threading.Tasks;

namespace Sample;

public class Bad
{
	// async void that isn't an event handler — exceptions escape, can't be awaited.
	public async void Foo()
	{
		await Task.Delay(1);
	}

	// Sync-over-async: blocks on a Task with .Result.
	public string Blocking()
	{
		return GetAsync().Result;
	}

	private Task<string> GetAsync()
	{
		return Task.FromResult("x");
	}
}
