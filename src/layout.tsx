import {
  Button,
  ButtonGroup,
  Heading,
  IconButton,
  Image,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FaDiscord, FaGithub, FaInfo } from "react-icons/fa";
import smLogo from "/logos/aibtcdev-avatar-250px.png";

export function Header() {
  return (
    <Stack
      align="center"
      justify="space-between"
      direction="row"
      px={24}
      py={16}
    >
      <Button variant="aibtcOrange">RSVP THURSDAYS</Button>
      <Button variant="aibtcOrange">MEETING MINUTES</Button>
    </Stack>
  );
}

export function Content() {
  return (
    <Stack
      alignItems="center"
      justifyContent={["flex-start", null, "center"]}
      flexGrow={1}
    >
      <Image src={smLogo} alt="AIBTC Logo" w={[200, 250]} py={4} />
      <Heading size="2xl" color="orange.400">
        Bitcoin x AI
      </Heading>
      <Text fontSize="x-large" textAlign="center" p={4}>
        Welcome to the working group!
      </Text>
      <Stack direction={["column", null, "row"]}>
        <Button
          size="lg"
          _hover={{ bg: "orange.400", color: "white" }}
          as="a"
          href="https://evt.to/emamdeggw"
          target="_blank"
          rel="noopener noreferrer"
        >
          RSVP Thursdays
        </Button>
        <Button
          size="lg"
          _hover={{ bg: "orange.400", color: "white" }}
          as="a"
          href="https://github.com/orgs/stacks-network/discussions/534"
          target="_blank"
          rel="noopener noreferrer"
        >
          Meeting Minutes
        </Button>
        <Button
          size="lg"
          _hover={{ bg: "orange.400", color: "white" }}
          as="a"
          href="https://docs.aibtc.dev"
          target="_blank"
          rel="noopener noreferrer"
        >
          Documentation
        </Button>
      </Stack>
    </Stack>
  );
}

export function Footer() {
  return (
    <Stack align="center" justify="space-between" direction="row" p={4}>
      <Text>&copy; 2024</Text>
      <ButtonGroup>
        <IconButton
          isRound
          _hover={{ bg: "orange.400", color: "white" }}
          aria-label="Working Group Info"
          title="Working Group Info"
          icon={<FaInfo />}
          size={["sm", null, "md"]}
          as="a"
          href="https://github.com/orgs/stacks-network/discussions/531"
          target="_blank"
          rel="noopener noreferrer"
        />
        <IconButton
          isRound
          _hover={{ bg: "orange.400", color: "white" }}
          aria-label="GitHub Resources"
          title="GitHub Resources"
          icon={<FaGithub />}
          size={["sm", null, "md"]}
          as="a"
          href="https://github.com/aibtcdev"
          target="_blank"
          rel="noopener noreferrer"
        />
        <IconButton
          isRound
          _hover={{ bg: "orange.400", color: "white" }}
          aria-label="Discord"
          title="Discord"
          icon={<FaDiscord />}
          size={["sm", null, "md"]}
          as="a"
          href="https://discord.gg/5DJaBrf"
          target="_blank"
          rel="noopener noreferrer"
        />
      </ButtonGroup>
    </Stack>
  );
}
