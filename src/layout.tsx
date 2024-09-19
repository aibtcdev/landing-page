import {
  Button,
  ButtonGroup,
  IconButton,
  Image,
  Stack,
} from "@chakra-ui/react";
import { FaBook, FaDiscord, FaRunning } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";
import { PiGithubLogoFill } from "react-icons/pi";
import { SiReplit } from "react-icons/si";
import aibtcLogoWide from "/logos/aibtcdev-primary-logo-white-wide-1000px.png";

export function Content() {
  return (
    <Stack
      className="bg-pattern-1"
      direction="column"
      height="100svh"
      alignItems="center"
      justifyContent="space-between"
    >
      <Stack
        direction="column"
        alignItems="center"
        justifyContent="center"
        flexGrow={1}
      >
        <Image
          src={aibtcLogoWide}
          alt="AIBTCDEV Wide Logo"
          w="100%"
          maxW="1000px"
          p={4}
        />
        <Stack
          direction={["column", "row"]}
          alignItems="center"
          justifyContent="center"
          gap={4}
          w="100%"
        >
          <Button
            variant="aibtcOrange"
            size="lg"
            as="a"
            href="https://run.aibtc.dev"
            target="_blank"
            rel="noopener noreferrer"
            w={["70%", "40%"]}
          >
            RUN AIBTC AGENTS
          </Button>
          <Button
            variant="aibtcOrange"
            size="lg"
            as="a"
            href="https://evt.to/emamdeggw"
            target="_blank"
            rel="noopener noreferrer"
            w={["70%", "40%"]}
          >
            RSVP THURSDAYS
          </Button>
        </Stack>
      </Stack>
      <Stack align="center" justify="center" direction="row" p={4}>
        <ButtonGroup>
          <IconButton
            isRound
            _hover={{ bg: "aibtc.orange.500", color: "white" }}
            aria-label="Run a Crew"
            title="Run a Crew"
            icon={<FaRunning />}
            size={["md", null, "lg"]}
            as="a"
            href="https://run.aibtc.dev"
            target="_blank"
            rel="noopener noreferrer"
          />
          <IconButton
            isRound
            _hover={{ bg: "aibtc.orange.500", color: "white" }}
            aria-label="AIBTC Documentation"
            title="AIBTC Documentation"
            icon={<FaBook />}
            size={["md", null, "lg"]}
            as="a"
            href="https://docs.aibtc.dev"
            target="_blank"
            rel="noopener noreferrer"
          />
          <IconButton
            isRound
            _hover={{ bg: "aibtc.orange.500", color: "white" }}
            aria-label="AIBTC GitHub"
            title="AIBTC GitHub"
            icon={<PiGithubLogoFill />}
            size={["md", null, "lg"]}
            as="a"
            href="https://github.com/aibtcdev"
            target="_blank"
            rel="noopener noreferrer"
          />
          <IconButton
            isRound
            _hover={{ bg: "aibtc.orange.500", color: "white" }}
            aria-label="AIBTC Replit"
            title="AIBTC Replit"
            icon={<SiReplit />}
            size={["md", null, "lg"]}
            as="a"
            href="https://replit.com/@wbtc402/ai-agent-crew"
            target="_blank"
            rel="noopener noreferrer"
          />
          <IconButton
            isRound
            _hover={{ bg: "aibtc.orange.500", color: "white" }}
            aria-label="AIBTC Discord"
            title="AIBTC Discord"
            icon={<FaDiscord />}
            size={["md", null, "lg"]}
            as="a"
            href="https://discord.gg/Z59Z3FNbEX"
            target="_blank"
            rel="noopener noreferrer"
          />
          <IconButton
            isRound
            _hover={{ bg: "aibtc.orange.500", color: "white" }}
            aria-label="AIBTC on X"
            title="AIBTC on X"
            icon={<FaXTwitter />}
            size={["md", null, "lg"]}
            as="a"
            href="https://x.com/aibtcdev"
            target="_blank"
            rel="noopener noreferrer"
          />
        </ButtonGroup>
      </Stack>
    </Stack>
  );
}
