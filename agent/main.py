from souldesk_agent.server import run


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        pass
