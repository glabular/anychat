namespace AnyChat.NET.Api;

public partial class Program
{
    private static void Main(string[] args)
    {
        AnyChatWebHost.Create(args).Run();
    }
}
